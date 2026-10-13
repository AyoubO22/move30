// Creates a realistic demo organization for sales demos and screenshots.
// Usage: DEMO_PASSWORD=... npm run seed:demo   (refuses to run in production)
import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { migrate, pool, tx } from "./db.js";
import { hashPassword } from "./security.js";
import { defaultPolicy } from "./policy.js";

if (config.isProd && process.env.ALLOW_DEMO_SEED !== "true") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

const password = process.env.DEMO_PASSWORD || randomBytes(9).toString("base64url");
const FIRST = ["Lena", "Tom", "Sara", "Yusuf", "Emma", "Lucas", "Nora", "Adam", "Ines", "Milan", "Julie", "Rayan", "Lotte", "Hugo", "Amira", "Victor", "Zoe", "Bram", "Chloe", "Noah", "Elise", "Karim", "Fien", "Louis"];
const TEAMS = ["Finance", "Customer Success", "Engineering"];

await migrate();
await tx(async (db) => {
  await db.query("DELETE FROM organizations WHERE slug = 'demo'");
  const policy = { ...defaultPolicy(), enforceWorkHours: false };
  const org = (await db.query("INSERT INTO organizations (name, slug, policy, accent) VALUES ('Northwind Demo', 'demo', $1, 'green') RETURNING id", [policy])).rows[0].id;
  const teamIds = [];
  for (const t of TEAMS) teamIds.push((await db.query("INSERT INTO teams (org_id, name) VALUES ($1, $2) RETURNING id", [org, t])).rows[0].id);
  // A small team that stays hidden in analytics (under the privacy threshold).
  const small = (await db.query("INSERT INTO teams (org_id, name) VALUES ($1, 'Legal') RETURNING id", [org])).rows[0].id;

  const hash = await hashPassword(password);
  const admin = (await db.query(
    "INSERT INTO users (org_id, team_id, team_since, email, name, password_hash, role) VALUES ($1, $2, now() - interval '60 days', 'admin@northwind.example', 'Demo Admin', $3, 'admin') RETURNING id",
    [org, teamIds[0], hash]
  )).rows[0].id;

  const users = [admin];
  for (let i = 0; i < FIRST.length; i++) {
    const team = i < 2 ? small : teamIds[i % TEAMS.length];
    users.push((await db.query(
      "INSERT INTO users (org_id, team_id, team_since, email, name, password_hash) VALUES ($1, $2, now() - interval '60 days', $3, $4, $5) RETURNING id",
      [org, team, `${FIRST[i].toLowerCase()}@northwind.example`, FIRST[i], hash]
    )).rows[0].id);
  }

  // 30 days of plausible breaks on weekdays, mostly between 9:00 and 17:00 Brussels time.
  const routines = ["desk-reset", "walk-5", "stair-burst", "stretch", "quick", "post-meal"];
  const rows = [];
  for (const [ui, uid] of users.entries()) {
    const habit = 3 + (ui % 7) * 1.4; // some people move more than others
    for (let d = 29; d >= 0; d--) {
      const date = new Date(Date.now() - d * 864e5);
      const dow = date.getUTCDay();
      if (dow === 0 || dow === 6 || Math.random() < 0.12) continue;
      const n = Math.max(0, Math.round(habit + (29 - d) * 0.08 + (Math.random() * 4 - 2)));
      for (let k = 0; k < n; k++) {
        const hour = 7 + Math.floor(Math.random() * 8.5); // UTC ≈ 9–17 in Brussels
        const t = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, Math.floor(Math.random() * 60)));
        if (t > new Date()) continue;
        const routine = routines[Math.floor(Math.random() * routines.length)];
        const minutes = { "desk-reset": 3, "walk-5": 5, "stair-burst": 1, stretch: 2, quick: 3, "post-meal": 15 }[routine];
        rows.push([uid, org, t, minutes, routine]);
      }
    }
  }
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const vals = chunk.map((_, j) => `($${j * 5 + 1}, $${j * 5 + 2}, $${j * 5 + 3}, $${j * 5 + 4}, $${j * 5 + 5})`).join(",");
    await db.query(`INSERT INTO breaks (user_id, org_id, taken_at, minutes, routine) VALUES ${vals}`, chunk.flat());
  }
  console.log(`Demo org "Northwind Demo" (id: demo) with ${users.length} people and ${rows.length} breaks.`);
});
console.log(`Sign in as admin@northwind.example (or lena@northwind.example) with password: ${password}`);
await pool.end();
