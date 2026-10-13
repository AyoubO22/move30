# Move30 — architecture summary (run-1, quick profile, commit 944cfbc)

## 1. Product, principals, protected resources
Move30 is a multi-tenant SaaS: an anti-sedentary break timer for office workers. Companies are `organizations`. Each user belongs to exactly one org (db/migrations/001_init.sql:29-43). Principals:
- **Anonymous internet user.** Can sign up (creating an org and becoming its admin; on by default, server/src/config.js:25), log in, read and accept invites, and start or finish OIDC SSO (server/src/routes/auth.js).
- **Member.** Has `/api/me/*` only: settings, profile, password, logging breaks, own summary, GDPR export, self-delete (server/src/routes/me.js:10).
- **Org admin.** Has `/api/org/*` for its own org (server/src/routes/org.js:11): branding, policy, allowed email domains, SSO config with an encrypted client secret, teams, members (role/team/remove), invites, aggregate analytics, org deletion.
- **External OIDC identity provider.** Configured per org by its admin. Its ID-token claims drive provisioning and account linking (auth.js:157-225).
- **Operator.** Sets environment variables (config.js).

Protected resources:
- per-user break history: individual health-adjacent behaviour, visible only to the user;
- account control: sessions and passwords;
- org membership and roles;
- the SSO client secret;
- tenant isolation between orgs;
- the privacy promise that admins only see aggregates for groups of at least MIN_GROUP_SIZE people (server/src/analytics.js).

## 2. Comparable baseline
The OIDC relying-party flow is the standard openid-client v5 Authorization Code + PKCE + state + nonce flow (auth.js:138-155). There is no comparable product baseline.

## 3. Stack and deployment
- **Server:** Node ≥20 ESM, Express 4, helmet, cookie-parser, express-rate-limit, zod, pg (PostgreSQL), @node-rs/argon2, openid-client 5.
- **Web:** React 19 SPA (Vite), served by the same Express process from web/dist (app.js:60-65).
- **Deployment assumption:** a reverse proxy (`trust proxy` defaults to 1 in production, config.js:31). No Dockerfile or CI in the repo.
- **Tests:** none.
- **Execution:** target-controlled execution is BLOCKED for this run. No OS-enforced sandbox meets every required control (no bwrap/nsjail; read-only toolchain and scratch-only writes cannot be enforced). Review is source-only.

## 4. Entry surfaces and key paths
`/api` middleware order: JSON body limit 32 kB → cookieParser → csrfGuard (requires the `x-move30: 1` header on non-GET requests; Origin must equal APP_URL when present, security.js:111-117) → loadUser (sha256 session-token lookup, security.js:83-94) → routers.

Unauthenticated routes (auth.js):
- signup and login, with an argon2 dummy hash for timing;
- invite GET/accept (token hash, atomic `used_at`);
- `GET /sso/:slug` (registered BEFORE `GET /sso/callback`);
- `GET /sso/callback`: signed state cookie → `client.callback` → claims → provisioning by (org, sub), else email link, else allowed_domains or invite.

Member routes (me.js) are all scoped by `req.user.id`.

Admin routes (org.js) are scoped by `req.user.org_id`.

Outbound fetch: `Issuer.discover(org.sso_issuer)` (auth.js:127), after `assertPublicHttpsUrl` (server/src/netguard.js).

Client (web/src): React text rendering; the admin-supplied `logoUrl` is rendered as `<img>` for all members (web/src/pages/Shell.tsx:54-55); Document Picture-in-Picture (web/src/timer.tsx).

## 5. Trust boundaries and strongest control
| Boundary | Strongest control |
|---|---|
| Anonymous → session | argon2 password + rate limit; random 32-byte session token, hashed |
| Cross-site → cookie-authenticated mutation | custom header + Origin check; SameSite=Lax |
| Org A admin → org B data | `org_id` predicates in every org.js query; email globally unique |
| Member → admin | `requireAdmin`; role change revokes sessions |
| External IdP claims → account identity | state/nonce/PKCE; (org, sub) binding; email link only within the same org; domain allowlist; `email_verified !== false` |
| Admin URL → server fetch | HTTPS + public-IP DNS check (TOCTOU with discover) |
| Admin → individual member activity | analytics suppression for small groups, no per-person endpoint |

Deployment facts not visible in source: NODE_ENV, APP_SECRET, APP_URL, TRUST_PROXY, FRAME_ANCESTORS, ALLOW_* flags, TLS/proxy, DB role.

## 6. Starting paths
server/src/routes/auth.js, server/src/routes/org.js, server/src/routes/me.js, server/src/security.js, server/src/netguard.js, server/src/analytics.js, server/src/app.js, server/src/config.js, server/src/policy.js, db/migrations/001_init.sql, web/src/pages/**, web/src/timer.tsx, web/src/session.tsx, web/src/api.ts.

Out of scope: web/src/components/arc/** and web/src/lib/** (third-party MIT UI library copied verbatim), node_modules.

## 7. Prior coverage
No prior run or ledger exists. This is the first pass, quick profile, so it is partial coverage.

## 8. Companion selection
- **WEB-PROTOCOL-AND-AUTH.md:** cookie sessions, CSRF, OIDC relying party, invite and account linking, password login.
- **DATA-ISOLATION-AND-LIFECYCLE.md:** multi-tenant org isolation, aggregate analytics privacy, export and deletion.
- **CLIENT-SIDE.md:** SPA rendering, admin-controlled URL rendering, CSP and framing.
- **Not selected:**
  - CLOUD (no IaC or containers in repo);
  - SUPPLY-CHAIN (no CI or release pipeline; lockfiles only);
  - PROTOCOLS (no RPC or queues);
  - RESOURCE-EXHAUSTION (no shared-spend surface beyond rate limits; covered by Obvious things);
  - AI, MEMORY-SAFETY, DESKTOP (absent).
