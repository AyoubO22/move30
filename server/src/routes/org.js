import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { q, tx } from "../db.js";
import { ah, HttpError, requireAdmin, newToken, hashToken, encrypt, destroySession } from "../security.js";
import { ACCENTS, policySchema } from "../policy.js";
import { assertPublicHttpsUrl } from "../netguard.js";
import { orgAnalytics } from "../analytics.js";

export const org = Router();
org.use(requireAdmin);

const uuid = z.string().uuid();

// ---------- Organization settings ----------
org.get("/", ah(async (req, res) => {
  const { rows } = await q("SELECT * FROM organizations WHERE id = $1", [req.user.org_id]);
  const o = rows[0];
  res.json({
    name: o.name, slug: o.slug, accent: o.accent, logoUrl: o.logo_url,
    policy: policySchema.parse(o.policy), allowedDomains: o.allowed_domains,
    sso: { enabled: o.sso_enabled, enforced: o.sso_enforced, issuer: o.sso_issuer, clientId: o.sso_client_id, hasSecret: !!o.sso_client_secret_enc },
    ssoLoginUrl: `${config.appUrl}/api/auth/sso/${o.slug}`,
    ssoRedirectUri: `${config.appUrl}/api/auth/sso/callback`,
    minGroupSize: config.minGroupSize,
  });
}));

const domain = z.string().trim().toLowerCase().regex(/^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/, "Invalid domain");

org.put("/", ah(async (req, res) => {
  const body = z.object({
    name: z.string().trim().min(2).max(80).optional(),
    accent: z.enum(ACCENTS).optional(),
    logoUrl: z.union([z.string().url().max(500).refine((u) => u.startsWith("https://"), "Logo must use HTTPS"), z.literal(""), z.null()]).optional(),
    policy: policySchema.optional(),
    allowedDomains: z.array(domain).max(20).optional(),
  }).strict().parse(req.body);

  const sets = [];
  const vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (body.name !== undefined) add("name", body.name);
  if (body.accent !== undefined) add("accent", body.accent);
  if (body.logoUrl !== undefined) add("logo_url", body.logoUrl || null);
  if (body.policy !== undefined) add("policy", body.policy);
  if (body.allowedDomains !== undefined) add("allowed_domains", [...new Set(body.allowedDomains)]);
  if (sets.length) {
    vals.push(req.user.org_id);
    await q(`UPDATE organizations SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
  }
  res.json({ ok: true });
}));

org.put("/sso", ah(async (req, res) => {
  const body = z.object({
    enabled: z.boolean(),
    enforced: z.boolean().default(false),
    issuer: z.string().trim().url().max(300).optional(),
    clientId: z.string().trim().min(1).max(300).optional(),
    clientSecret: z.string().min(1).max(1000).optional(),
  }).strict().parse(req.body);

  const cur = (await q("SELECT sso_enabled, sso_enforced, sso_issuer, sso_client_id, sso_client_secret_enc FROM organizations WHERE id = $1", [req.user.org_id])).rows[0];
  const issuer = body.issuer ?? cur.sso_issuer;
  const clientId = body.clientId ?? cur.sso_client_id;
  const secretEnc = body.clientSecret ? encrypt(body.clientSecret) : cur.sso_client_secret_enc;
  if (body.enabled) {
    if (!issuer || !clientId || !secretEnc) throw new HttpError(400, "Issuer, client ID and client secret are required.", "sso_incomplete");
    await assertPublicHttpsUrl(issuer);
  }
  const enforced = body.enabled && body.enforced;
  await tx(async (db) => {
    await db.query(
      "UPDATE organizations SET sso_enabled = $1, sso_enforced = $2, sso_issuer = $3, sso_client_id = $4, sso_client_secret_enc = $5 WHERE id = $6",
      [body.enabled, enforced, issuer || null, clientId || null, secretEnc || null, req.user.org_id]
    );
    // A new identity provider must not inherit the old one's identities: people re-link on next sign-in.
    if ((issuer || null) !== cur.sso_issuer) {
      await db.query("UPDATE users SET sso_sub = NULL, sso_issuer = NULL WHERE org_id = $1", [req.user.org_id]);
    }
    // Turning enforcement on ends members' password sessions right away.
    if (enforced && !(cur.sso_enabled && cur.sso_enforced)) {
      await db.query("DELETE FROM sessions s USING users u WHERE s.user_id = u.id AND u.org_id = $1 AND u.role <> 'admin'", [req.user.org_id]);
    }
  });
  res.json({ ok: true });
}));

org.delete("/", ah(async (req, res) => {
  const o = (await q("SELECT name FROM organizations WHERE id = $1", [req.user.org_id])).rows[0];
  z.object({ confirm: z.literal(o.name) }).strict().parse(req.body);
  await destroySession(req, res);
  await q("DELETE FROM organizations WHERE id = $1", [req.user.org_id]);
  res.json({ ok: true });
}));

// ---------- Teams ----------
org.get("/teams", ah(async (req, res) => {
  const { rows } = await q(
    `SELECT t.id, t.name, count(u.id)::int AS members FROM teams t
       LEFT JOIN users u ON u.team_id = t.id WHERE t.org_id = $1 GROUP BY t.id ORDER BY t.name`,
    [req.user.org_id]
  );
  res.json({ teams: rows });
}));

org.post("/teams", ah(async (req, res) => {
  const body = z.object({ name: z.string().trim().min(1).max(60) }).strict().parse(req.body);
  const count = (await q("SELECT count(*)::int AS n FROM teams WHERE org_id = $1", [req.user.org_id])).rows[0].n;
  if (count >= 200) throw new HttpError(400, "Team limit reached.", "limit");
  const { rows } = await q(
    "INSERT INTO teams (org_id, name) VALUES ($1, $2) ON CONFLICT (org_id, name) DO NOTHING RETURNING id, name",
    [req.user.org_id, body.name]
  );
  if (!rows[0]) throw new HttpError(409, "A team with this name already exists.", "team_exists");
  res.status(201).json({ team: rows[0] });
}));

org.patch("/teams/:id", ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const body = z.object({ name: z.string().trim().min(1).max(60) }).strict().parse(req.body);
  const r = await q("UPDATE teams SET name = $1 WHERE id = $2 AND org_id = $3", [body.name, id, req.user.org_id]);
  if (!r.rowCount) throw new HttpError(404, "Team not found.", "not_found");
  res.json({ ok: true });
}));

org.delete("/teams/:id", ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const r = await q("DELETE FROM teams WHERE id = $1 AND org_id = $2", [id, req.user.org_id]);
  if (!r.rowCount) throw new HttpError(404, "Team not found.", "not_found");
  res.json({ ok: true });
}));

// ---------- Members (no activity data, by design) ----------
org.get("/members", ah(async (req, res) => {
  const { rows } = await q(
    `SELECT u.id, u.name, u.email, u.role, u.team_id AS "teamId", u.created_at AS "joinedAt", (u.sso_sub IS NOT NULL) AS sso
       FROM users u WHERE u.org_id = $1 ORDER BY lower(u.name)`,
    [req.user.org_id]
  );
  res.json({ members: rows });
}));

org.patch("/members/:id", ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const body = z.object({ role: z.enum(["member", "admin"]).optional(), teamId: uuid.nullable().optional() }).strict().parse(req.body);
  await tx(async (db) => {
    // Lock every admin row of the org so two concurrent demotions cannot both pass the last-admin check.
    await db.query("SELECT id FROM users WHERE org_id = $1 AND role = 'admin' FOR UPDATE", [req.user.org_id]);
    const target = (await db.query("SELECT id, role FROM users WHERE id = $1 AND org_id = $2 FOR UPDATE", [id, req.user.org_id])).rows[0];
    if (!target) throw new HttpError(404, "Member not found.", "not_found");
    if (body.teamId) {
      const t = await db.query("SELECT 1 FROM teams WHERE id = $1 AND org_id = $2", [body.teamId, req.user.org_id]);
      if (!t.rowCount) throw new HttpError(400, "Unknown team.", "bad_team");
    }
    if (body.role === "member" && target.role === "admin") {
      const admins = (await db.query("SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND role = 'admin'", [req.user.org_id])).rows[0].n;
      if (admins <= 1) throw new HttpError(409, "An organization needs at least one admin.", "last_admin");
    }
    if (body.role !== undefined) await db.query("UPDATE users SET role = $1 WHERE id = $2", [body.role, id]);
    if (body.teamId !== undefined) await db.query("UPDATE users SET team_id = $1, team_since = now() WHERE id = $2 AND team_id IS DISTINCT FROM $1", [body.teamId, id]);
    // A role change ends the person's sessions so new permissions apply immediately,
    // and a demoted admin's pending invites die with their admin rights.
    if (body.role !== undefined && body.role !== target.role) {
      await db.query("DELETE FROM sessions WHERE user_id = $1", [id]);
      if (body.role === "member") await db.query("DELETE FROM invites WHERE created_by = $1 AND used_at IS NULL", [id]);
    }
  });
  res.json({ ok: true });
}));

org.delete("/members/:id", ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  if (id === req.user.id) throw new HttpError(400, "Use 'Delete my account' in your settings instead.", "self");
  await tx(async (db) => {
    await db.query("SELECT id FROM users WHERE org_id = $1 AND role = 'admin' FOR UPDATE", [req.user.org_id]);
    // Invites minted by a removed person must not let them back in (delete before created_by is nulled).
    await db.query("DELETE FROM invites WHERE created_by = $1 AND org_id = $2 AND used_at IS NULL", [id, req.user.org_id]);
    const r = await db.query("DELETE FROM users WHERE id = $1 AND org_id = $2 RETURNING id", [id, req.user.org_id]);
    if (!r.rowCount) throw new HttpError(404, "Member not found.", "not_found");
  });
  res.json({ ok: true });
}));

// ---------- Invites ----------
org.get("/invites", ah(async (req, res) => {
  const { rows } = await q(
    `SELECT encode(i.token_hash, 'hex') AS id, i.email, i.role, i.team_id AS "teamId", i.created_at AS "createdAt",
            i.expires_at AS "expiresAt", u.name AS "createdBy"
       FROM invites i LEFT JOIN users u ON u.id = i.created_by
      WHERE i.org_id = $1 AND i.used_at IS NULL AND i.expires_at > now() ORDER BY i.created_at DESC`,
    [req.user.org_id]
  );
  res.json({ invites: rows });
}));

org.post("/invites", ah(async (req, res) => {
  const body = z.object({
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    role: z.enum(["member", "admin"]).default("member"),
    teamId: uuid.nullable().optional(),
  }).strict().parse(req.body);
  if (body.teamId) {
    const t = await q("SELECT 1 FROM teams WHERE id = $1 AND org_id = $2", [body.teamId, req.user.org_id]);
    if (!t.rowCount) throw new HttpError(400, "Unknown team.", "bad_team");
  }
  const pending = (await q("SELECT count(*)::int AS n FROM invites WHERE org_id = $1 AND used_at IS NULL AND expires_at > now()", [req.user.org_id])).rows[0].n;
  if (pending >= 500) throw new HttpError(400, "Too many pending invites.", "limit");
  const token = newToken();
  const expires = new Date(Date.now() + config.inviteDays * 864e5);
  await q(
    "INSERT INTO invites (token_hash, org_id, email, role, team_id, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [hashToken(token), req.user.org_id, body.email || null, body.role, body.teamId || null, req.user.id, expires]
  );
  // The link is shown once; only its hash is stored.
  res.status(201).json({ url: `${config.appUrl}/invite/${token}`, expiresAt: expires });
}));

org.delete("/invites/:id", ah(async (req, res) => {
  const id = z.string().regex(/^[0-9a-f]{64}$/).parse(req.params.id);
  await q("DELETE FROM invites WHERE token_hash = decode($1, 'hex') AND org_id = $2", [id, req.user.org_id]);
  res.json({ ok: true });
}));

// ---------- Analytics ----------
org.get("/analytics", ah(async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const o = (await q("SELECT policy FROM organizations WHERE id = $1", [req.user.org_id])).rows[0];
  const p = policySchema.parse(o.policy);
  res.json(await orgAnalytics(req.user.org_id, { days, tz: p.timezone, dailyGoal: p.dailyGoal }));
}));
