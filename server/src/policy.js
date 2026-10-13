import { z } from "zod";

export const ACCENTS = ["neutral", "violet", "blue", "green", "amber", "orange", "coral", "rose"];
export const ROUTINES = ["desk-reset", "walk-5", "stair-burst", "post-meal", "stretch", "quick"];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const interval = z.union([z.literal(20), z.literal(30), z.literal(45), z.literal(60)]);

export function isTimeZone(tz) {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

export const policySchema = z.object({
  interval: interval.default(30),
  workStart: time.default("09:00"),
  workEnd: time.default("17:30"),
  workdays: z.array(z.number().int().min(0).max(6)).max(7).default([1, 2, 3, 4, 5]),
  timezone: z.string().max(64).refine(isTimeZone, "Unknown time zone").default("Europe/Brussels"),
  enforceWorkHours: z.boolean().default(true),
  allowOverride: z.boolean().default(true),
  dailyGoal: z.number().int().min(1).max(30).default(12),
}).strict();

export const userSettingsSchema = z.object({
  interval: interval.optional(),
  workStart: time.optional(),
  workEnd: time.optional(),
  enforceWorkHours: z.boolean().optional(),
  dailyGoal: z.number().int().min(1).max(30).optional(),
  chime: z.boolean().optional(),
  notifications: z.boolean().optional(),
}).strict();

export const defaultPolicy = () => policySchema.parse({});

/** Org policy wins unless the org lets people adjust their own timer. Comfort settings are always personal. */
export function effectiveSettings(orgPolicy, userSettings) {
  const p = policySchema.parse(orgPolicy || {});
  const u = userSettingsSchema.partial().safeParse(userSettings || {}).data || {};
  const pick = (k) => (p.allowOverride && u[k] !== undefined ? u[k] : p[k]);
  return {
    interval: pick("interval"),
    workStart: pick("workStart"),
    workEnd: pick("workEnd"),
    enforceWorkHours: pick("enforceWorkHours"),
    dailyGoal: pick("dailyGoal"),
    workdays: p.workdays,
    timezone: p.timezone,
    chime: u.chime ?? false,
    notifications: u.notifications ?? true,
    locked: !p.allowOverride,
  };
}

const RESERVED_SLUGS = new Set(["callback", "api", "admin", "login", "signup", "invite", "sso"]);

export function slugify(name) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  const slug = base.length >= 2 ? base : `org-${base}`;
  // Reserved: would collide with fixed routes such as /api/auth/sso/callback.
  return RESERVED_SLUGS.has(slug) ? `${slug}-org` : slug;
}
