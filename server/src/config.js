import { createHash } from "node:crypto";

function bool(v, fallback) {
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

const env = process.env;
const isProd = env.NODE_ENV === "production";

if (isProd && (!env.APP_SECRET || env.APP_SECRET.length < 32)) {
  throw new Error("APP_SECRET must be set to at least 32 random characters in production.");
}

// A public HTTPS deployment must never fall back to the dev secret, even if NODE_ENV was forgotten.
if (!env.APP_SECRET && /^https:\/\//i.test(env.APP_URL || "") && !/^https:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(env.APP_URL)) {
  throw new Error("APP_SECRET must be set when APP_URL is a public https:// address.");
}

const secret = env.APP_SECRET || "dev-only-insecure-secret-change-me-please-0000";

/** Positive integer from the environment, or a clear startup error instead of a silent NaN. */
function int(name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return n;
}

export const config = {
  isProd,
  port: int("PORT", 3000, 1, 65535),
  appUrl: (env.APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
  databaseUrl: env.DATABASE_URL || "postgres://postgres@localhost:5432/move30",
  // Two independent keys derived from APP_SECRET: one to sign cookies/state, one to encrypt stored secrets.
  signKey: createHash("sha256").update("move30:sign:" + secret).digest(),
  encKey: createHash("sha256").update("move30:enc:" + secret).digest(),
  allowSignup: bool(env.ALLOW_SIGNUP, true),
  // Aggregated analytics are only shown for groups of at least this many people.
  minGroupSize: int("MIN_GROUP_SIZE", 5, 3, 1000),
  // People only count toward a team's privacy threshold after this many days in the team.
  teamSettleDays: int("TEAM_SETTLE_DAYS", 14, 0, 365),
  sessionDays: int("SESSION_DAYS", 14, 1, 90),
  inviteDays: int("INVITE_DAYS", 7, 1, 30),
  // Extra frame ancestors, e.g. Microsoft Teams, so the app can run as a Teams tab.
  frameAncestors: (env.FRAME_ANCESTORS || "").split(/\s+/).filter(Boolean),
  trustProxy: env.TRUST_PROXY || (isProd ? "1" : "0"),
  allowPrivateIssuer: bool(env.ALLOW_PRIVATE_SSO_ISSUER, false),
};
