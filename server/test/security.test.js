// Regression tests for the security audit fixes. Needs a disposable PostgreSQL database:
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/move30_test npm test
// The database is wiped at the start of the run. Never point this at real data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const DB = process.env.TEST_DATABASE_URL;
if (!DB) { console.log("TEST_DATABASE_URL not set, skipping."); process.exit(0); }
process.env.DATABASE_URL = DB;
process.env.MIN_GROUP_SIZE = "3";
process.env.TEAM_SETTLE_DAYS = "14";

const { pool, migrate, q } = await import("../src/db.js");
const { createApp } = await import("../src/app.js");
const { isPrivateIp, safeLookup, assertPublicHttpsUrl } = await import("../src/netguard.js");
const { slugify } = await import("../src/policy.js");

let server, base;
before(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.APP_URL = base;
});
after(async () => { server?.close(); await pool.end(); });

/** Tiny cookie-keeping client. */
function client() {
  let cookie = "";
  const call = async (method, path, body, headers = { "x-move30": "1" }) => {
    const r = await fetch(base + path, {
      method, redirect: "manual",
      headers: { "content-type": "application/json", cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    let data = null; try { data = await r.json(); } catch { /* empty */ }
    return { status: r.status, data };
  };
  return { call, get: (p) => call("GET", p), post: (p, b) => call("POST", p, b ?? {}), put: (p, b) => call("PUT", p, b), patch: (p, b) => call("PATCH", p, b), del: (p, b) => call("DELETE", p, b ?? {}) };
}

let n = 0;
const uniq = (s) => `${s}${++n}`;
async function newOrg() {
  const admin = client();
  const r = await admin.post("/api/auth/signup", { orgName: uniq("Org "), name: "Admin", email: `${uniq("admin")}@test.example`, password: "correct-horse-1" });
  assert.equal(r.status, 201);
  return admin;
}
async function join(admin, role = "member", extra = {}) {
  const inv = await admin.post("/api/org/invites", { role, ...extra });
  assert.equal(inv.status, 201);
  const token = inv.data.url.split("/invite/")[1];
  const c = client();
  const email = `${uniq("user")}@test.example`;
  const r = await c.post(`/api/auth/invite/${token}/accept`, { name: "User", email, password: "correct-horse-1" });
  return { c, r, token, email };
}

test("state-changing requests without the CSRF header are rejected", async () => {
  const admin = await newOrg();
  const r = await admin.call("POST", "/api/org/teams", { name: "X" }, {});
  assert.equal(r.status, 403);
});

test("invites minted by an admin die when that admin is demoted", async () => {
  const a1 = await newOrg();
  const { c: a2 } = await join(a1, "admin");
  const me1 = await a1.get("/api/me");
  const inv = await a1.post("/api/org/invites", { role: "admin" });
  const token = inv.data.url.split("/invite/")[1];
  assert.equal((await a2.patch(`/api/org/members/${me1.data.user.id}`, { role: "member" })).status, 200);
  const r = await client().post(`/api/auth/invite/${token}/accept`, { name: "Back", email: `${uniq("back")}@test.example`, password: "correct-horse-1" });
  assert.equal(r.status, 404);
});

test("invites minted by an admin die when that admin is removed", async () => {
  const a1 = await newOrg();
  const { c: a2 } = await join(a1, "admin");
  const me1 = await a1.get("/api/me");
  const inv = await a1.post("/api/org/invites", { role: "admin" });
  const token = inv.data.url.split("/invite/")[1];
  assert.equal((await a2.del(`/api/org/members/${me1.data.user.id}`)).status, 200);
  const r = await client().post(`/api/auth/invite/${token}/accept`, { name: "Back", email: `${uniq("back")}@test.example`, password: "correct-horse-1" });
  assert.equal(r.status, 404);
});

test("concurrent mutual demotion always leaves an admin", async () => {
  const a1 = await newOrg();
  const { c: a2 } = await join(a1, "admin");
  const id1 = (await a1.get("/api/me")).data.user.id;
  const id2 = (await a2.get("/api/me")).data.user.id;
  await Promise.all([a1.patch(`/api/org/members/${id2}`, { role: "member" }), a2.patch(`/api/org/members/${id1}`, { role: "member" })]);
  const { rows } = await q("SELECT count(*)::int AS n FROM users WHERE id = ANY($1) AND role = 'admin'", [[id1, id2]]);
  assert.ok(rows[0].n >= 1);
});

test("password invites are refused for members when the org enforces SSO", async () => {
  const admin = await newOrg();
  const me = await admin.get("/api/me");
  await q("UPDATE organizations SET sso_enabled = true, sso_enforced = true WHERE slug = $1", [me.data.org.slug]);
  const { r } = await join(admin, "member");
  assert.equal(r.status, 403);
  assert.equal(r.data.code, "sso_required");
});

test("shared multi-tenant Microsoft issuers are rejected", async () => {
  await assert.rejects(assertPublicHttpsUrl("https://login.microsoftonline.com/common/v2.0"), /tenant-specific/);
  await assert.rejects(assertPublicHttpsUrl("https://login.microsoftonline.com/organizations/v2.0"), /tenant-specific/);
  await assert.rejects(assertPublicHttpsUrl("http://example.com/"), /HTTPS/);
});

test("private and special addresses are recognised", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "198.18.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPrivateIp(ip), false, ip);
});

test("the connection-time lookup refuses private addresses", async () => {
  const err = await new Promise((resolve) => safeLookup("localhost", {}, (e) => resolve(e)));
  assert.equal(err?.code, "EBLOCKED");
});

test("reserved slugs cannot shadow fixed routes", () => {
  assert.notEqual(slugify("Callback"), "callback");
  assert.notEqual(slugify("API"), "api");
});

test("analytics: a team packed at the last minute around one person is hidden", async () => {
  const admin = await newOrg();
  const team = (await admin.post("/api/org/teams", { name: "Packed" })).data.team;
  const people = [];
  for (let i = 0; i < 4; i++) people.push(await join(admin, "member"));
  await people[0].c.post("/api/me/breaks", { minutes: 3 });
  for (const p of people) {
    const id = (await p.c.get("/api/me")).data.user.id;
    assert.equal((await admin.patch(`/api/org/members/${id}`, { teamId: team.id })).status, 200);
  }
  const a = await admin.get("/api/org/analytics?days=7");
  assert.equal(a.status, 200);
  assert.equal(a.data.teams.find((t) => t.name === "Packed"), undefined);
  // One active person out of five: participation must not be released.
  assert.equal(a.data.overview.participation, null);
});

test("members cannot read organization analytics", async () => {
  const admin = await newOrg();
  const { c } = await join(admin);
  assert.equal((await c.get("/api/org/analytics")).status, 403);
});

test("identity-provider requests to private hosts are blocked at connection time", async () => {
  await import("../src/routes/auth.js"); // installs the lookup hook
  const { Issuer } = await import("openid-client");
  await assert.rejects(Issuer.discover("https://localhost:9/"), (e) => e.code === "EBLOCKED");
});
