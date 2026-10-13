import { randomBytes, createHash, createHmac, createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { config } from "./config.js";
import { q } from "./db.js";

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Wrap async route handlers so rejections reach the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Tokens ----------
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token) => createHash("sha256").update(String(token)).digest();

// ---------- Passwords ----------
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (pw) => argonHash(pw, ARGON);
// Verifying against a fixed dummy hash keeps response times similar for unknown emails.
let dummyHash;
export async function verifyPassword(hash, pw) {
  if (!hash) {
    dummyHash ||= await argonHash("dummy-password-for-timing", ARGON);
    await argonVerify(dummyHash, pw).catch(() => false);
    return false;
  }
  return argonVerify(hash, pw).catch(() => false);
}

// ---------- Secret encryption at rest (AES-256-GCM) ----------
export function encrypt(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.encKey, iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}
export function decrypt(blob) {
  const [v, iv, tag, data] = String(blob).split(".");
  if (v !== "v1") throw new Error("unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", config.encKey, Buffer.from(iv, "base64url"), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

// ---------- Signed values (for short-lived cookies like SSO state) ----------
export function sign(obj) {
  const body = Buffer.from(JSON.stringify(obj)).toString("base64url");
  const mac = createHmac("sha256", config.signKey).update(body).digest("base64url");
  return `${body}.${mac}`;
}
export function unsign(value) {
  const [body, mac] = String(value || "").split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", config.signKey).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
}

// ---------- Sessions ----------
export const SESSION_COOKIE = config.isProd ? "__Host-m30_sid" : "m30_sid";
const cookieBase = () => ({ httpOnly: true, secure: config.isProd, sameSite: "lax", path: "/" });

export async function createSession(res, userId, db = { query: q }) {
  const token = newToken();
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [hashToken(token), userId, expires]);
  res.cookie(SESSION_COOKIE, token, { ...cookieBase(), expires });
}

export async function destroySession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await q("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
  res.clearCookie(SESSION_COOKIE, cookieBase());
}

/** Loads req.user (with org) when a valid session cookie is present. */
export const loadUser = ah(async (req, _res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const { rows } = await q(
    `SELECT u.id, u.org_id, u.team_id, u.email, u.name, u.role, u.settings, (u.password_hash IS NOT NULL) AS has_password
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)]
  );
  if (rows[0]) req.user = rows[0];
  next();
});

export function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, "Please sign in.", "unauthenticated"));
  next();
}
export function requireAdmin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, "Please sign in.", "unauthenticated"));
  if (req.user.role !== "admin") return next(new HttpError(403, "Admins only.", "forbidden"));
  next();
}

/**
 * CSRF defence for cookie-authenticated API calls: every state-changing request must carry a custom header
 * (which a cross-site form cannot send and cross-site fetch cannot send without a CORS preflight we never allow),
 * and, when the browser sends an Origin, it must be our own.
 */
export function csrfGuard(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-move30") !== "1") return next(new HttpError(403, "Missing request header.", "csrf"));
  const origin = req.get("origin");
  if (origin && origin !== config.appUrl) return next(new HttpError(403, "Cross-origin request blocked.", "csrf"));
  next();
}
