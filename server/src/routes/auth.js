import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { Issuer, generators, custom } from "openid-client";
import { config } from "../config.js";
import { q, tx } from "../db.js";
import { ah, HttpError, hashPassword, verifyPassword, createSession, destroySession, hashToken, sign, unsign, decrypt } from "../security.js";
import { defaultPolicy, slugify } from "../policy.js";
import { assertPublicHttpsUrl, safeLookup } from "../netguard.js";

// Every request openid-client makes (discovery, token, JWKS) resolves through safeLookup,
// which refuses private addresses at connection time.
custom.setHttpOptionsDefaults({ lookup: safeLookup, timeout: 5000 });

export const auth = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in a few minutes.", code: "rate_limited" },
});

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(10, "Use at least 10 characters.").max(200);
const name = z.string().trim().min(1).max(80);

// ---------- Create an organization (trial / self-serve) ----------
auth.post("/signup", authLimiter, ah(async (req, res) => {
  if (!config.allowSignup) throw new HttpError(403, "Self-serve signup is disabled on this server.", "signup_disabled");
  const body = z.object({ orgName: z.string().trim().min(2).max(80), name, email, password }).strict().parse(req.body);

  const user = await tx(async (db) => {
    const taken = await db.query("SELECT 1 FROM users WHERE lower(email) = $1", [body.email]);
    if (taken.rowCount) throw new HttpError(409, "An account with this email already exists.", "email_taken");
    let slug = slugify(body.orgName);
    for (let i = 0; i < 5; i++) {
      const exists = await db.query("SELECT 1 FROM organizations WHERE slug = $1", [slug]);
      if (!exists.rowCount) break;
      slug = `${slugify(body.orgName).slice(0, 26)}-${Math.random().toString(36).slice(2, 7)}`;
    }
    const org = await db.query(
      "INSERT INTO organizations (name, slug, policy) VALUES ($1, $2, $3) RETURNING id",
      [body.orgName, slug, defaultPolicy()]
    );
    const u = await db.query(
      "INSERT INTO users (org_id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, 'admin') RETURNING id",
      [org.rows[0].id, body.email, body.name, await hashPassword(body.password)]
    );
    await createSession(res, u.rows[0].id, db);
    return u.rows[0];
  });
  res.status(201).json({ ok: true, userId: user.id });
}));

// ---------- Password login ----------
auth.post("/login", authLimiter, ah(async (req, res) => {
  const body = z.object({ email, password: z.string().max(200) }).strict().parse(req.body);
  const { rows } = await q(
    `SELECT u.id, u.password_hash, u.role, o.sso_enabled, o.sso_enforced
       FROM users u JOIN organizations o ON o.id = u.org_id WHERE lower(u.email) = $1`,
    [body.email]
  );
  const u = rows[0];
  const ok = await verifyPassword(u?.password_hash, body.password);
  if (!u || !ok) throw new HttpError(401, "Wrong email or password.", "bad_credentials");
  // When an org enforces SSO, members must use it. Admins keep password access as a break-glass account.
  if (u.sso_enabled && u.sso_enforced && u.role !== "admin") {
    throw new HttpError(403, "Your organization requires single sign-on.", "sso_required");
  }
  await createSession(res, u.id);
  res.json({ ok: true });
}));

auth.post("/logout", ah(async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
}));

// ---------- Invites ----------
async function findInvite(token) {
  const { rows } = await q(
    `SELECT i.token_hash, i.org_id, i.email, i.role, i.team_id, o.name AS org_name, o.sso_enabled, o.sso_enforced, o.slug
       FROM invites i JOIN organizations o ON o.id = i.org_id
      WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now()`,
    [hashToken(token)]
  );
  if (!rows[0]) throw new HttpError(404, "This invite link is invalid or has expired.", "invite_invalid");
  return rows[0];
}

auth.get("/invite/:token", authLimiter, ah(async (req, res) => {
  const inv = await findInvite(req.params.token);
  res.json({ orgName: inv.org_name, email: inv.email, ssoEnabled: inv.sso_enabled, orgSlug: inv.slug });
}));

auth.post("/invite/:token/accept", authLimiter, ah(async (req, res) => {
  const inv = await findInvite(req.params.token);
  // When SSO is required, members join through the identity provider, which proves who they are.
  if (inv.sso_enabled && inv.sso_enforced && inv.role !== "admin") {
    throw new HttpError(403, "Your organization requires single sign-on. Use the company sign-in button.", "sso_required");
  }
  const body = z.object({ name, email: inv.email ? email.optional() : email, password }).strict().parse(req.body);
  const finalEmail = inv.email || body.email;
  if (inv.email && body.email && body.email !== inv.email) throw new HttpError(400, "This invite is for a different email.", "invite_email");

  await tx(async (db) => {
    // Mark used first, guarded on used_at, so two parallel accepts cannot both succeed.
    const used = await db.query("UPDATE invites SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL RETURNING 1", [inv.token_hash]);
    if (!used.rowCount) throw new HttpError(404, "This invite link has already been used.", "invite_invalid");
    const taken = await db.query("SELECT 1 FROM users WHERE lower(email) = $1", [finalEmail]);
    if (taken.rowCount) throw new HttpError(409, "An account with this email already exists.", "email_taken");
    const u = await db.query(
      "INSERT INTO users (org_id, team_id, team_since, email, name, password_hash, role) VALUES ($1, $2, now(), $3, $4, $5, $6) RETURNING id",
      [inv.org_id, inv.team_id, finalEmail, body.name, await hashPassword(body.password), inv.role]
    );
    await createSession(res, u.rows[0].id, db);
  });
  res.status(201).json({ ok: true });
}));

// ---------- Single sign-on (OpenID Connect: Microsoft Entra ID, Google Workspace, Okta…) ----------
const SSO_COOKIE = "m30_sso";
const redirectUri = () => `${config.appUrl}/api/auth/sso/callback`;
const issuerCache = new Map(); // issuer URL -> { issuer, at }
const trimSlash = (u) => String(u).replace(/\/+$/, "");

async function getClient(org) {
  if (!org.sso_enabled || !org.sso_issuer || !org.sso_client_id || !org.sso_client_secret_enc) {
    throw new HttpError(400, "Single sign-on is not set up for this organization.", "sso_off");
  }
  await assertPublicHttpsUrl(org.sso_issuer);
  let cached = issuerCache.get(org.sso_issuer);
  if (!cached || Date.now() - cached.at > 10 * 60 * 1000) {
    const issuer = await Issuer.discover(org.sso_issuer);
    const md = issuer.metadata;
    // One tenant only: a templated issuer would accept tokens from any tenant.
    if (!md.issuer || md.issuer.includes("{") || trimSlash(md.issuer) !== trimSlash(org.sso_issuer)) {
      throw new HttpError(400, "The identity provider's issuer does not match the configured issuer.", "issuer_mismatch");
    }
    // The provider chooses these URLs, so they get the same public-HTTPS policy as the issuer.
    for (const [key, what] of [["token_endpoint", "token endpoint"], ["jwks_uri", "JWKS endpoint"], ["authorization_endpoint", "authorization endpoint"]]) {
      if (!md[key]) throw new HttpError(400, `The identity provider has no ${what}.`, "bad_issuer");
      await assertPublicHttpsUrl(md[key], what);
    }
    cached = { issuer, at: Date.now() };
    issuerCache.set(org.sso_issuer, cached);
  }
  return new cached.issuer.Client({
    client_id: org.sso_client_id,
    client_secret: decrypt(org.sso_client_secret_enc),
    redirect_uris: [redirectUri()],
    response_types: ["code"],
  });
}

auth.get("/sso/:slug", authLimiter, ah(async (req, res, next) => {
  if (req.params.slug === "callback") return next();
  const { rows } = await q("SELECT * FROM organizations WHERE slug = $1", [String(req.params.slug).toLowerCase()]);
  if (!rows[0]) throw new HttpError(404, "Unknown organization.", "org_unknown");
  const client = await getClient(rows[0]);
  const state = generators.state();
  const nonce = generators.nonce();
  const verifier = generators.codeVerifier();
  const invite = typeof req.query.invite === "string" ? req.query.invite.slice(0, 100) : undefined;
  res.cookie(SSO_COOKIE, sign({ orgId: rows[0].id, state, nonce, verifier, invite, exp: Date.now() + 10 * 60 * 1000 }), {
    httpOnly: true, secure: config.isProd, sameSite: "lax", path: "/api/auth/sso", maxAge: 10 * 60 * 1000,
  });
  res.redirect(client.authorizationUrl({
    scope: "openid email profile",
    state, nonce,
    code_challenge: generators.codeChallenge(verifier),
    code_challenge_method: "S256",
  }));
}));

auth.get("/sso/callback", authLimiter, ah(async (req, res) => {
  const fail = (code) => res.redirect(`/login?error=${encodeURIComponent(code)}`);
  const st = unsign(req.cookies?.[SSO_COOKIE]);
  res.clearCookie(SSO_COOKIE, { path: "/api/auth/sso" });
  if (!st || st.exp < Date.now()) return fail("sso_expired");

  const { rows } = await q("SELECT * FROM organizations WHERE id = $1", [st.orgId]);
  const org = rows[0];
  if (!org) return fail("sso_failed");

  let claims;
  try {
    const client = await getClient(org);
    const tokenSet = await client.callback(redirectUri(), client.callbackParams(req), {
      state: st.state, nonce: st.nonce, code_verifier: st.verifier,
    });
    claims = tokenSet.claims();
  } catch {
    return fail("sso_failed");
  }

  const sub = String(claims.sub || "");
  const rawEmail = String(claims.email || claims.preferred_username || "").toLowerCase();
  if (!sub || !rawEmail.includes("@") || claims.email_verified === false) return fail("sso_no_email");
  const domain = rawEmail.split("@")[1];

  const userId = await tx(async (db) => {
    // 1. Known identity in this org.
    let r = await db.query("SELECT id FROM users WHERE org_id = $1 AND sso_sub = $2 AND sso_issuer = $3", [org.id, sub, org.sso_issuer]);
    if (r.rows[0]) return r.rows[0].id;

    // 2. Existing account with this email: link it only if it belongs to this org and has no other SSO identity.
    r = await db.query("SELECT id, org_id, sso_sub, role FROM users WHERE lower(email) = $1 FOR UPDATE", [rawEmail]);
    if (r.rows[0]) {
      const u = r.rows[0];
      if (u.org_id !== org.id || u.sso_sub) throw new HttpError(409, "sso_conflict");
      // From now on the identity provider vouches for this account. Whoever created the account
      // before (for example from a shared invite link) loses access: every existing session ends,
      // and members lose the password. Admins keep theirs as a break-glass login.
      await db.query(
        "UPDATE users SET sso_sub = $1, sso_issuer = $2, password_hash = CASE WHEN role = 'admin' THEN password_hash ELSE NULL END WHERE id = $3",
        [sub, org.sso_issuer, u.id]
      );
      await db.query("DELETE FROM sessions WHERE user_id = $1", [u.id]);
      return u.id;
    }

    // 3. New person: allowed through an unused invite for this org, or an allowed company email domain.
    let role = "member";
    let teamId = null;
    let allowed = org.allowed_domains.includes(domain);
    if (st.invite) {
      const inv = await db.query(
        `UPDATE invites SET used_at = now()
          WHERE token_hash = $1 AND org_id = $2 AND used_at IS NULL AND expires_at > now()
            AND (email IS NULL OR lower(email) = $3)
          RETURNING role, team_id`,
        [hashToken(st.invite), org.id, rawEmail]
      );
      if (inv.rows[0]) { allowed = true; role = inv.rows[0].role; teamId = inv.rows[0].team_id; }
    }
    if (!allowed) throw new HttpError(403, "sso_not_allowed");
    const display = String(claims.name || rawEmail.split("@")[0]).slice(0, 80) || "Member";
    const ins = await db.query(
      "INSERT INTO users (org_id, team_id, team_since, email, name, role, sso_sub, sso_issuer) VALUES ($1, $2, now(), $3, $4, $5, $6, $7) RETURNING id",
      [org.id, teamId, rawEmail, display, role, sub, org.sso_issuer]
    );
    return ins.rows[0].id;
  }).catch((err) => {
    if (err instanceof HttpError) return { error: err.message };
    throw err;
  });

  if (typeof userId === "object") return fail(userId.error);
  await createSession(res, userId);
  res.redirect("/");
}));
