import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { q, tx } from "../db.js";
import { ah, HttpError, requireUser, hashPassword, verifyPassword, destroySession, createSession } from "../security.js";
import { effectiveSettings, userSettingsSchema, policySchema, ROUTINES } from "../policy.js";
import { lastDays } from "../time.js";

export const me = Router();
me.use(requireUser);

async function loadOrg(orgId) {
  const { rows } = await q("SELECT id, name, slug, accent, logo_url, policy, sso_enabled FROM organizations WHERE id = $1", [orgId]);
  return rows[0];
}

me.get("/", ah(async (req, res) => {
  const org = await loadOrg(req.user.org_id);
  const team = req.user.team_id
    ? (await q("SELECT id, name FROM teams WHERE id = $1", [req.user.team_id])).rows[0] || null
    : null;
  res.json({
    user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role, hasPassword: req.user.has_password, team },
    org: { name: org.name, slug: org.slug, accent: org.accent, logoUrl: org.logo_url, ssoEnabled: org.sso_enabled },
    settings: effectiveSettings(org.policy, req.user.settings),
  });
}));

me.put("/settings", ah(async (req, res) => {
  const body = userSettingsSchema.parse(req.body);
  const merged = { ...req.user.settings, ...body };
  await q("UPDATE users SET settings = $1 WHERE id = $2", [merged, req.user.id]);
  const org = await loadOrg(req.user.org_id);
  res.json({ settings: effectiveSettings(org.policy, merged) });
}));

me.put("/profile", ah(async (req, res) => {
  const body = z.object({ name: z.string().trim().min(1).max(80) }).strict().parse(req.body);
  await q("UPDATE users SET name = $1 WHERE id = $2", [body.name, req.user.id]);
  res.json({ ok: true });
}));

const pwLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });

me.post("/password", pwLimiter, ah(async (req, res) => {
  const body = z.object({ current: z.string().max(200).optional(), next: z.string().min(10).max(200) }).strict().parse(req.body);
  const { rows } = await q("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
  if (rows[0].password_hash && !(await verifyPassword(rows[0].password_hash, body.current || ""))) {
    throw new HttpError(400, "Your current password is wrong.", "bad_password");
  }
  await tx(async (db) => {
    await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [await hashPassword(body.next), req.user.id]);
    // Sign out every other device, then issue a fresh session for this one.
    await db.query("DELETE FROM sessions WHERE user_id = $1", [req.user.id]);
    await createSession(res, req.user.id, db);
  });
  res.json({ ok: true });
}));

// ---------- Breaks ----------
me.post("/breaks", ah(async (req, res) => {
  const body = z.object({
    minutes: z.number().min(0.5).max(30),
    routine: z.enum(ROUTINES).optional(),
  }).strict().parse(req.body);

  const recent = await q(
    `SELECT count(*) FILTER (WHERE taken_at > now() - interval '60 seconds')::int AS last_min,
            count(*) FILTER (WHERE taken_at > now() - interval '24 hours')::int AS last_day
       FROM breaks WHERE user_id = $1 AND taken_at > now() - interval '24 hours'`,
    [req.user.id]
  );
  if (recent.rows[0].last_min > 0) throw new HttpError(429, "You just logged a break. Give it a minute.", "too_soon");
  if (recent.rows[0].last_day >= 80) throw new HttpError(429, "Daily limit reached.", "daily_limit");

  await q("INSERT INTO breaks (user_id, org_id, minutes, routine) VALUES ($1, $2, $3, $4)",
    [req.user.id, req.user.org_id, body.minutes, body.routine || null]);
  res.status(201).json({ ok: true });
}));

me.get("/summary", ah(async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
  const org = await loadOrg(req.user.org_id);
  const tz = policySchema.parse(org.policy).timezone;
  const { rows } = await q(
    `SELECT to_char((taken_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS day, count(*)::int AS breaks, sum(minutes)::float AS minutes
       FROM breaks WHERE user_id = $1 AND taken_at > now() - make_interval(days => $2::int + 1)
      GROUP BY 1`,
    [req.user.id, days, tz]
  );
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const series = lastDays(tz, days).map((day) => ({
    day, breaks: byDay.get(day)?.breaks || 0, minutes: Math.round((byDay.get(day)?.minutes || 0) * 10) / 10,
  }));
  res.json({ today: series[series.length - 1], series });
}));

// ---------- GDPR: access and erasure ----------
me.get("/export", ah(async (req, res) => {
  const user = (await q("SELECT id, email, name, role, settings, created_at FROM users WHERE id = $1", [req.user.id])).rows[0];
  const breaks = (await q("SELECT taken_at, minutes::float AS minutes, routine FROM breaks WHERE user_id = $1 ORDER BY taken_at", [req.user.id])).rows;
  res.setHeader("Content-Disposition", 'attachment; filename="move30-my-data.json"');
  res.json({ exportedAt: new Date().toISOString(), user, breaks });
}));

me.delete("/", ah(async (req, res) => {
  z.object({ confirm: z.literal("DELETE") }).strict().parse(req.body);
  await tx(async (db) => {
    // Locks the org's admin rows so the last-admin check cannot race a concurrent demotion.
    const admins = (await db.query("SELECT id FROM users WHERE org_id = $1 AND role = 'admin' FOR UPDATE", [req.user.org_id])).rows;
    if (req.user.role === "admin" && admins.length <= 1) {
      const members = await db.query("SELECT count(*)::int AS n FROM users WHERE org_id = $1 AND id <> $2", [req.user.org_id, req.user.id]);
      if (members.rows[0].n > 0) {
        throw new HttpError(409, "You are the last admin. Make someone else admin first, or delete the organization.", "last_admin");
      }
    }
    await db.query("DELETE FROM invites WHERE created_by = $1 AND used_at IS NULL", [req.user.id]);
    const { rows } = await db.query("DELETE FROM users WHERE id = $1 RETURNING org_id", [req.user.id]);
    // The last person leaving takes the empty organization with them.
    const left = await db.query("SELECT 1 FROM users WHERE org_id = $1 LIMIT 1", [rows[0].org_id]);
    if (!left.rowCount) await db.query("DELETE FROM organizations WHERE id = $1", [rows[0].org_id]);
  });
  await destroySession(req, res);
  res.json({ ok: true });
}));
