# Needs validation

These are prioritized leads without severity. Each one names its source trace, the exact blocker, and bounded resolution plans. None of them was executed (source-only run).

## SSO callback links an existing same-org account by IdP email claim alone; an org admin who controls the IdP (or an IdP that lets users choose their email) can get a session as that member
`auth.js/sso-callback/email-autolink-without-proof`

When no user matches (org, sub), step 2 of GET /api/auth/sso/callback looks up a user by the token's email (falling back to preferred_username; only email_verified === false is rejected). If that user is in the same org and has no sso_sub, the IdP sub is written onto the account and a session is created, with no credential or session from that account. Org admins choose the IdP (PUT /api/org/sso), so an admin pointing SSO at an IdP they control can log in as any not-yet-linked member and read that member's individual break history (/api/me/summary, /api/me/export), which the product promises admins never see. Step 1 matches (org_id, sub) without binding the issuer, so after an issuer change an admin can also replay a linked member's sub. A second path exists without an admin when the IdP lets users set an unverified email or preferred_username.

**Claimed root cause.** Step 2 of /api/auth/sso/callback (auth.js:179-193) treats the email claim (preferred_username fallback, missing email_verified accepted) as proof of ownership of an existing same-org account with null sso_sub; no existing credential or session is required, and sso_sub is not bound to the issuer, while the org admin chooses the IdP and individual activity is promised visible only to the member.

**Trace**
- entrypoint: `server/src/routes/org.js:55` (PUT /api/org/sso (requireAdmin)): Org admin sets any public HTTPS issuer, client ID and secret.
- propagation: `server/src/routes/auth.js:170` (GET /api/auth/sso/callback): client.callback validates the token against the admin-configured IdP only.
- propagation: `server/src/routes/auth.js:179` (GET /api/auth/sso/callback): rawEmail from claims.email or claims.preferred_username.
- propagation: `server/src/routes/auth.js:180` (GET /api/auth/sso/callback): Only email_verified === false is rejected.
- propagation: `server/src/routes/auth.js:189` (SSO provisioning step 2): Existing user selected by lower(email); refused only for another org or existing sso_sub (line 191).
- sink: `server/src/routes/auth.js:192` (SSO provisioning step 2): Writes the supplied sub onto the victim account; createSession at line 223 issues a session for it.

**Evidence**
- `server/src/routes/org.js:70`: Issuer only checked by assertPublicHttpsUrl.
- `server/src/routes/org.js:124`: Comment: members listing has no activity data by design.
- `server/src/analytics.js:10`: Admins are meant to see only suppressed aggregates.
- `server/src/routes/auth.js:185`: Step 1 matches (org_id, sub) without an issuer binding.
- `db/migrations/001_init.sql:38`: users.sso_sub has no issuer column.
- `server/src/routes/me.js:99`: GET /api/me/export returns the session user's individual history.

**Blockers**
- no OS-enforced sandbox available for bounded local execution
- For the non-admin path: whether the deployed IdP lets users set an unverified email or preferred_username and omits email_verified (IdP policy outside the repository).

**Local plan.** In an approved sandbox with a disposable PostgreSQL and a mock OIDC issuer (netguard stubbed in a scratch copy): seed org O with admin A and password-only member M (sso_sub NULL) plus one break for M. As A enable SSO to the mock issuer; mock issues sub='attacker-1', email=M's address, no email_verified. Complete /api/auth/sso/<slug> then /callback with no M credentials. Vulnerable if users.sso_sub for M becomes 'attacker-1' and GET /api/me/export with the returned cookie shows M's break. Stop there.

**Owner-observed check.** Owner confirms whether org admins are untrusted with respect to members' individual break data, and whether configured IdPs always send email_verified=true and prevent user-edited email/UPN.

## Multi-tenant Entra issuer (common/organizations/consumers) accepted, so ID tokens from any Microsoft tenant can reach email-based linking and provisioning in the org
`auth.js/sso-callback/multitenant-issuer-accepted`

PUT /api/org/sso accepts the shared Microsoft endpoints despite a UI hint asking for a tenant-specific issuer. openid-client 5.7.1 enables aadIssValidation for those discovery URLs and substitutes the token's own tid into the expected issuer, so a validly signed token from any tenant passes. The callback then links by email (step 2) or provisions through allowed_domains (step 3) and creates a session. Exploitation also needs a multi-tenant app registration and a foreign-tenant user able to carry a chosen email claim; those facts are outside the repository.

**Claimed root cause.** The server never limits the configured issuer to a single tenant (no rejection of the shared Entra discovery URLs or of a '{tenantid}' templated metadata.issuer, no tid check), while openid-client accepts any tenant's iss for those URLs and the callback trusts the unverified-by-default email claim.

**Trace**
- entrypoint: `server/src/routes/org.js:55` (org.put('/sso')): Issuer stored after zod url() and assertPublicHttpsUrl only.
- propagation: `server/src/routes/auth.js:127` (getClient): Issuer.discover builds the client; discovered issuer not compared with the configured URL.
- propagation: `server/node_modules/openid-client/lib/issuer.js:156` (Issuer.discover): Sets the AAD multitenant flag for common/organizations/consumers.
- propagation: `server/node_modules/openid-client/lib/client.js:953` (Client#validateJWT): Expected iss = issuer with the token's own tid substituted.
- sink: `server/src/routes/auth.js:189` (GET /sso/callback provisioning): Accepted foreign-tenant email links or provisions an account; session at line 223.

**Evidence**
- `web/src/pages/admin/Security.tsx:73`: Tenant-specific issuer is only a UI hint.
- `server/node_modules/openid-client/lib/issuer.js:13`: AAD_MULTITENANT_DISCOVERY list.
- `server/src/routes/auth.js:180`: Missing email_verified accepted.
- `server/src/routes/auth.js:191`: Linking not bound to issuer or tenant.

**Blockers**
- no OS-enforced sandbox available for bounded local execution
- Whether any deployed org stores a multi-tenant Entra issuer (deployment data).
- Whether the Entra app registration is multi-tenant (outside the repository).
- Whether a foreign-tenant user can obtain a token for that client with a chosen email or preferred_username (Entra policy).

**Local plan.** In an approved sandbox with no network, serve a fixture discovery document mapped to the common v2.0 URL with issuer 'https://login.microsoftonline.com/{tenantid}/v2.0' and a local JWKS; with dummy org O (sso_issuer = common URL) and member victim@example.test (no sso_sub), complete the callback with an ID token tid=attacker-tenant, matching iss, correct aud/nonce, email=victim@example.test, no email_verified. Vulnerable if victim's sso_sub is set and a session cookie returned; control with a tenant-specific issuer fails with sso_failed.

**Owner-observed check.** Owner runs a read-only query for organizations.sso_issuer matching login.microsoftonline.com/(common|organizations|consumers) and checks the matching app registrations' supported account types.

## Email-less invite lets the holder register any unverified email, which SSO later links to the real owner (pre-hijack / SSO-enforcement bypass)
`move30/invite-accept-unverified-email-prehijack`

For an invite created without an email, POST /api/auth/invite/:token/accept takes the account email from the request body without ownership proof, creates a password account in the org and opens a session, without checking sso_enforced. When the real owner later signs in by SSO, step 2 links their IdP sub to that row without clearing password_hash or revoking sessions, so the invite holder keeps access through the 14-day session and, when SSO is not enforced or the invite role was admin, through password login. The pre-registered row also blocks the real owner from accepting their own invite.

**Claimed root cause.** Invite accept uses body.email for email-less invites without ownership proof (auth.js:96-97) and ignores org.sso_enforced; SSO step 2 (auth.js:189-193) later links the victim's sub to that account without clearing password_hash or revoking existing sessions.

**Trace**
- entrypoint: `server/src/routes/auth.js:94` (auth.post('/invite/:token/accept')): Unauthenticated accept gated only by the invite token.
- propagation: `server/src/routes/auth.js:97` (auth.post('/invite/:token/accept')): finalEmail = inv.email || body.email.
- propagation: `server/src/routes/auth.js:106` (accept transaction): Inserts the user with the attacker's password and the invite role; no sso_enforced check; session at line 110.
- propagation: `server/src/routes/auth.js:189` (auth.get('/sso/callback') step 2): Victim's SSO login finds the row by email.
- sink: `server/src/routes/auth.js:192` (auth.get('/sso/callback') step 2): sso_sub set on the attacker-created row; password_hash and sessions kept.

**Evidence**
- `server/src/routes/org.js:176`: Invite email optional.
- `server/src/routes/auth.js:65`: Password login under enforcement still allowed for admins.
- `server/src/security.js:69`: Session from accept lasts SESSION_DAYS and is not revoked by the link.
- `db/migrations/001_init.sql:42`: Global email uniqueness lets the first registrant win the address.

**Blockers**
- no OS-enforced sandbox available for bounded local execution
- Whether orgs hand email-less invite links to people other than the owners of the emails used, and whether the IdP sends email_verified (deployment and process facts).

**Local plan.** In an approved sandbox with a disposable PostgreSQL and mock OIDC issuer: admin creates an email-less invite; attacker accepts with victim@o.test and a known password, keeping the cookie; victim completes SSO with matching email. Vulnerable if the attacker row gets the victim's sso_sub with password_hash still set and the attacker's original cookie reads the victim's break via GET /api/me/export.

**Owner-observed check.** Owner runs read-only counts of invites with NULL email and of users with both sso_sub and password_hash set.

## Pending admin-role invites survive demotion or removal of the admin who created them
`move30/invite-outlives-creator-admin-revocation`

An admin can mint email-less invites with role 'admin'. Demotion (PATCH /api/org/members/:id) deletes only the person's sessions and removal deletes the user row, but their invites stay valid until expiry (INVITE_DAYS, default 7); created_by becomes NULL and the invite list does not show the creator, so remaining admins cannot tell which invites to revoke. The revoked person can accept a kept link with any unused email and regain an admin account, defeating the revocation that the code comment says applies immediately.

**Claimed root cause.** Admin revocation (org.js:148-151, org.js:159) never revokes invites the revoked admin created; invites.created_by is ON DELETE SET NULL (001_init.sql:59) and not exposed in the list (org.js:167); accept (auth.js:94-109) and SSO redemption (auth.js:200-208) grant inv.role without checking the creator's current authority.

**Trace**
- entrypoint: `server/src/routes/org.js:174` (POST /api/org/invites): Admin creates an email-less role 'admin' invite.
- propagation: `server/src/routes/org.js:151` (PATCH /api/org/members/:id): Demotion deletes only sessions.
- propagation: `server/src/routes/org.js:159` (DELETE /api/org/members/:id): Removal leaves the creator's invites untouched.
- propagation: `db/migrations/001_init.sql:59` (invites table): created_by ON DELETE SET NULL keeps the invite alive.
- propagation: `server/src/routes/auth.js:82` (findInvite): Validity checks only hash, used_at and expiry.
- sink: `server/src/routes/auth.js:108` (POST /api/auth/invite/:token/accept): Inserts a user with role inv.role ('admin') and a session.

**Evidence**
- `server/src/routes/org.js:150`: Comment states new permissions should apply immediately.
- `server/src/routes/org.js:185`: Up to 500 pending invites per org.
- `server/src/routes/org.js:198`: Mitigation: remaining admins can delete pending invites.
- `server/src/routes/auth.js:208`: SSO path also assigns inv.role.

**Blockers**
- no OS-enforced sandbox available for bounded local execution
- Product intent: whether pending invites are org-owned (survive their creator) or carry the creator's authority.

**Local plan.** In an approved sandbox: admins A and B in dummy org O; A creates {role:'admin'} invite; B demotes (then, separately, deletes) A; accept A's token unauthenticated with a fresh email. Vulnerable if a 201 response creates an admin user in O and GET /api/org/members succeeds with the new cookie.

**Owner-observed check.** Owner states production INVITE_DAYS and whether invites from a demoted or removed admin should stay redeemable.

## SSRF guard covers only the SSO issuer URL; discovered token_endpoint and jwks_uri (http:// or private IPs) are fetched unchecked, and DNS is not pinned
`netguard.js/sso-discovered-endpoints-unguarded`

Self-serve signup (default on) lets an anonymous user become an org admin and set an SSO issuer. assertPublicHttpsUrl checks only that issuer string, using a DNS lookup the later connection does not reuse. openid-client then trusts the discovery document: on the callback it POSTs a form body with Basic credentials to the metadata token_endpoint and may GET the metadata jwks_uri, accepting http: and any address. The attacker runs the IdP and can trigger the callback at will. Errors collapse to /login?error=sso_failed, so this is a blind SSRF with fixed request shapes whose impact depends on what the deployed host can reach.

**Claimed root cause.** assertPublicHttpsUrl (netguard.js:23-34) checks only the admin-typed issuer through a separate, unpinned DNS lookup; metadata-supplied token_endpoint and jwks_uri go to openid-client's request helper, which allows http: and any address, and the app sets no http_options/lookup hook applying the same policy.

**Trace**
- entrypoint: `server/src/routes/org.js:55` (org.put('/sso')): Admin (reachable via open signup) stores the issuer.
- propagation: `server/src/netguard.js:30` (assertPublicHttpsUrl): Resolves only the issuer host; address not pinned.
- propagation: `server/src/routes/auth.js:127` (getClient): Issuer.discover re-resolves and keeps all metadata endpoints.
- propagation: `server/src/routes/auth.js:170` (GET /sso/callback): client.callback runs the token grant.
- propagation: `server/node_modules/openid-client/lib/helpers/client.js:174` (authenticatedPost): targetUrl = issuer.token_endpoint from metadata.
- sink: `server/node_modules/openid-client/lib/helpers/request.js:123` (request): http(s).request to the unvalidated URL; http: allowed at line 69.

**Evidence**
- `server/src/routes/auth.js:124`: Only org.sso_issuer re-checked before discovery.
- `server/src/config.js:25`: allowSignup defaults to true.
- `server/node_modules/openid-client/lib/helpers/issuer.js:39`: jwks_uri fetched without validation.
- `server/src/routes/auth.js:175`: Errors collapse to sso_failed, so the SSRF is blind.

**Blockers**
- no OS-enforced sandbox available for bounded local execution
- Which internal or link-local services the deployed host can reach and whether egress filtering blocks them.

**Local plan.** In an approved sandbox with no external network: a fake HTTPS IdP (resolver maps it to a non-private test IP) whose metadata sets token_endpoint=http://127.0.0.1:9999/probe; a loopback listener on 9999 logs requests. Sign up, PUT /api/org/sso, GET /api/auth/sso/<slug>, then GET /callback?code=x&state=<state>. Vulnerable if the listener logs a POST with grant_type=authorization_code.

**Owner-observed check.** Owner reports whether ALLOW_SIGNUP is on in production and whether host egress allows RFC1918, loopback or 169.254.0.0/16 destinations.

## Org admin can single out one member's activity despite MIN_GROUP_SIZE by composing a team of the target plus admin-controlled accounts
`server/src/analytics.js:orgAnalytics:min-group-suppression-bypass-via-admin-controlled-group-composition`

MIN_GROUP_SIZE is enforced as a headcount over teams whose composition the admin controls: any member can be moved into any team, and email-less invites accepted with arbitrary emails create extra members at will. Person-days are labelled with the current team_id, so a moved member's past breaks follow them. Team participation is returned without an active>=min gate (revealing whether the target was active), and avgBreaksPerDay mixes the target's unknown counts with known contributions from controlled accounts across 7/30/90-day windows.

**Claimed root cause.** Suppression is a headcount check over admin-controlled groups (team reassignment, self-accepted email-less invites, controlled accounts with known break logs), applied retroactively through the current users.team_id, and team participation is released without the active>=min gate.

**Trace**
- entrypoint: `server/src/routes/org.js:203` (GET /api/org/analytics): Admin requests aggregates.
- propagation: `server/src/routes/org.js:173` (POST /api/org/invites): Email-less invites into a chosen team.
- propagation: `server/src/routes/auth.js:94` (POST /api/auth/invite/:token/accept): Admin accepts invites with arbitrary emails.
- propagation: `server/src/routes/org.js:149` (PATCH /api/org/members/:id): Admin moves the target into the team.
- propagation: `server/src/analytics.js:21` (orgAnalytics personDays): Grouped by current team_id, so history follows the target.
- propagation: `server/src/analytics.js:73` (orgAnalytics team loop): Team listed when headcount >= min.
- sink: `server/src/analytics.js:79` (orgAnalytics team output): participation always released; avgBreaksPerDay when active >= min.

**Evidence**
- `server/src/analytics.js:10`: Stated invariant implemented only as a headcount.
- `server/src/config.js:27`: minGroupSize = max(3, MIN_GROUP_SIZE || 5).
- `server/src/analytics.js:80`: avgBreaksPerDay gated, participation is not.
- `server/src/routes/me.js:76`: Controlled accounts can log known breaks.

**Blockers**
- no OS-enforced sandbox available for bounded local execution
- Threat-model fact: whether the MIN_GROUP_SIZE promise must hold against an admin who controls some group members and reassigns teams.

**Local plan.** In an approved sandbox with MIN_GROUP_SIZE=5: target M logs breaks; admin creates team T, moves M in, adds 4 dummy invites into T with no breaks; GET /api/org/analytics?days=7 should show participation 0.2 (vs 0 when M is inactive). Stop at that response.

**Owner-observed check.** Product owner states whether the aggregate-only promise must hold against admin-controlled group members, and the deployed MIN_GROUP_SIZE.
