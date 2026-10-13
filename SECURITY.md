# Security

## Reporting a vulnerability
Please open a private security advisory on GitHub (Security → Report a vulnerability). Don't use a public issue. Include steps to reproduce against a local install, not against someone else's deployment.

## Trust model
- **Employees (members)** see only their own break history. Nobody else can read it, admins included.
- **Organization admins** manage people, teams, policy and single sign-on. They see only anonymous team statistics: a group is shown only when it has at least `MIN_GROUP_SIZE` active people who have been in it for at least `TEAM_SETTLE_DAYS`.
- **Identity providers are trusted like your IdP admins.** Whoever configures SSO for an organization decides who can sign in as whom, exactly as in any SSO-enabled product. Only people who are already trusted at that level should be made admins.
- **Operators** (whoever hosts the server) have database access and therefore see everything. Host Move30 where your company's data-protection rules allow.

## Audit
The codebase was reviewed with [Cloudflare's security-audit skill](https://github.com/cloudflare/security-audit-skill) in its `quick` profile:
- 4 reconnaissance agents;
- 4 hunters covering 14 coverage units;
- 1 coverage critic;
- 6 independent verifiers.

The run was source-only because no fully sandboxed execution environment was available, so it produced no `confirmed` findings. It produced six `needs_validation` leads. All six were then fixed and covered by regression tests (`server/test/security.test.js`). The full report is in [`docs/security-audit/`](docs/security-audit/REPORT.md). It describes the code as it was at audit time, before the fixes.

| Audit lead | Fix |
|---|---|
| Invites survive the demotion or removal of the admin who created them | Demoting or removing an admin, or self-deleting, deletes their pending invites. The invite list shows who created each one. |
| Email-less invite lets someone register a colleague's email before they join through SSO | When SSO is enforced, member invites must go through SSO. Linking an SSO identity to an existing account ends every session on that account and removes a member's password. |
| SSO links existing accounts by email claim; identities not bound to the issuer | Each SSO identity is stored with its issuer. Changing the issuer clears old links. Linking ends existing sessions. Admin-controlled IdPs remain a documented trust assumption (see above). |
| Shared multi-tenant Microsoft issuers accepted | `common`, `organizations` and `consumers` are rejected. The discovered issuer must exactly equal the configured one and must not be templated. |
| SSRF guard only covered the issuer URL | Every outbound identity-provider request (discovery, token, JWKS) resolves through a DNS lookup that refuses private, loopback, link-local and special ranges at connection time. Discovered endpoints must be public HTTPS. |
| Small-group suppression could be bypassed by packing a team | Participation is released only when enough people are active. Team stats use only breaks taken after joining the team. A person counts toward a team's threshold only after `TEAM_SETTLE_DAYS`. The per-day "hidden" flag was removed. |

Hardening applied from the audit notes:
- Last-admin checks now lock every admin row, so concurrent demotions cannot remove the last admin.
- Turning on SSO enforcement ends members' password sessions.
- The `callback` slug and other route words are reserved.
- Numeric settings are validated at startup instead of silently becoming `NaN`.
- The server refuses to start on a public `https://` URL without `APP_SECRET`.
- AES-GCM tag length is pinned.
- `.gitignore` is wider.

Known remaining items (deferred by the audit, not yet reviewed in depth):
- Squatting an email address through self-serve signup. Set `ALLOW_SIGNUP=false` for single-company installs.
- Login CSRF on the SSO start route.
- Rate-limit keying behind proxies. Set `TRUST_PROXY` to your real hop count.
- Export and erasure completeness.
