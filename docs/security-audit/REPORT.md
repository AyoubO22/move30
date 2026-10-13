# Move30 — Security audit report (run-1)

## 1. Run scope and limits
- **Profile:** `quick`, so this is a partial pass and not an exhaustive audit. There was one hunter wave and one final coverage critic.
- **Scope:** `server/`, `db/`, and `web/src`. The copied third-party UI library (`web/src/components/arc`, `web/src/lib`) and `node_modules` were out of scope, except that installed openid-client source was read to check library behaviour.
- **Source ref:** commit `944cfbc`, clean worktree.
- **Budget:** 15 agent invocations, all spent: 4 reconnaissance, 4 hunters, 1 critic, 6 verifiers. The budget was proposed by the parent at 14 and raised to 15 before validation; it was not user-set.
- **Execution:** source-only. No OS-enforced sandbox with every required control (empty environment, no network, read-only toolchain, scratch-only writes, resource limits) was available, so no target-controlled code ran during the audit. As a result no finding could reach `confirmed`, and every surviving candidate is a `needs_validation` lead with a bounded local plan.
- **Prior runs:** none; this is the first run.
- **Deferred coverage:** 4 units the critic accepted are recorded as `deferred` (quick profile). See section 7.

## 2. Security posture summary
The building blocks are solid:
- random hashed session tokens;
- Argon2id with timing equalisation;
- strict custom-header and Origin CSRF defence;
- an `org_id` predicate on every admin query;
- a strict CSP;
- AES-GCM for stored SSO secrets.

No tenant-isolation break between organisations was found. The weak points sit around identity and trust in the people who configure the org:
- SSO account linking trusts the email claim.
- Invites carry authority on their own, independent of the admin who created them.
- The SSRF guard covers only the issuer URL.
- The aggregate-privacy promise rests on a headcount that admins can pad with accounts they control.

## 3. Confirmed findings
None. Confirmation required bounded local execution, which this run could not perform.

## 4. Confirmed finding details
Not applicable.

## 5. NEEDS VALIDATION (no severity)
| Lead | Trace | Blocker | Bounded local next step | Owner check |
|---|---|---|---|---|
| SSO callback links an existing account by email claim alone (admin-controlled IdP or user-editable email) | org.js:55 → auth.js:170 → auth.js:179-180 → auth.js:189 → auth.js:192 | No sandbox; IdP email policy | Mock IdP issues the member's email with no email_verified; check sso_sub and the export | Are org admins untrusted for individual data? Do IdPs send email_verified? |
| Multi-tenant Entra issuer accepted | org.js:55 → auth.js:127 → openid-client issuer.js:156 → client.js:953 → auth.js:189 | No sandbox; deployed issuer values; Entra app registration | Fixture discovery with a `{tenantid}` issuer and a foreign-tid token | Query `sso_issuer` for common/organizations/consumers |
| Email-less invite pre-hijack | auth.js:94 → :97 → :106 → :189 → :192 | No sandbox; invite usage in practice | Accept with the victim's email, then victim SSO login, then read with the attacker's cookie | Count NULL-email invites and users with both sso_sub and password |
| Admin invites outlive their creator's demotion or removal | org.js:174 → :151 / :159 → 001_init.sql:59 → auth.js:82 → :108 | No sandbox; product intent | Demote the creator, then accept their admin invite | Production INVITE_DAYS; intended invite ownership |
| SSRF guard covers only the issuer; discovered endpoints unchecked | org.js:55 → netguard.js:30 → auth.js:127 → :170 → openid-client client.js:174 → request.js:123 | No sandbox; host egress | Fake IdP with token_endpoint on loopback; listener logs a POST | ALLOW_SIGNUP and the egress policy |
| Small-group suppression bypass by team composition | org.js:203 → :173 → auth.js:94 → org.js:149 → analytics.js:21 → :73 → :79 | No sandbox; threat model | Team of target plus 4 dummies; participation 0.2 vs 0 | Must the promise hold against admin-controlled members? |

## 6. Hardening notes (not findings)
- **Organization and access lifecycle**
  - The last-admin protection can race: a demotion locks only the target row, and the self-delete check runs outside the transaction.
  - Enabling `sso_enforced` does not revoke existing member password sessions.
  - Switching accounts leaves the previous session row valid.
  - An SSO-only user can set a password without re-authenticating, which gives admins persistence beyond IdP deprovisioning.
- **SSO**
  - The slug `callback` is not reserved and would shadow `/sso/callback`.
  - SSO start via a cross-site GET enables login CSRF into an attacker org.
- **Configuration**
  - Non-numeric `MIN_GROUP_SIZE`, `SESSION_DAYS` or `INVITE_DAYS` produce NaN, which silently disables suppression.
  - Production safety depends on `NODE_ENV`; fail closed when APP_URL is https.
- **Crypto**
  - Pass `authTagLength: 16` and use the org id as AAD in AES-GCM.
  - Document that APP_SECRET must be random bytes; only its length is checked.
- **Privacy signals**
  - An admin-hosted `logoUrl` lets the admin observe members' page loads.
  - The daily-series `suppressed` flag and org participation leak small-count signals.
- **Repository and deployment**
  - Widen `.gitignore` to `.env.*`, `*.pem` and `*.key`.
  - Document exact `FRAME_ANCESTORS` origins.

Positive patterns: the CSRF design, per-request role re-reads, the atomic invite consumption, `.strict()` schemas everywhere, no CORS, and CSP with `script-src 'self'`.

## 7. Coverage summary
- **Totals:** 18 ledger units in all.
  - 7 covered;
  - 7 candidate, linked to 6 unique fingerprints (one root cause was found independently by two hunters);
  - 0 blocked;
  - 4 deferred.
- **Deferred units** (final critic, quick profile):
  - signup email squatting (account-linking collision);
  - issuer rotation versus existing `sso_sub` bindings;
  - export and erasure completeness;
  - pre-auth rate-limit keying and work imbalance under `trust proxy`.
- **Critic result:** the final critic's accepted units were recorded as deferred, not assigned. No clean-coverage claim is made.
