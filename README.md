# Move30

**Healthier desk days, without the noise.** Move30 is a break timer for office teams. It quietly reminds people to stand up every 30 minutes, guides one-to-fifteen-minute micro-breaks, and gives employers anonymous team insights without exposing anyone individually.

Research suggests that getting up for a few minutes every half hour lowers blood sugar and blood pressure more than one long break. The app's *Science* page summarises the studies.

## Features

**For employees**
- **Silent by default.** Notifications are silent and there is no sound. The tab title blinks and its icon turns orange when it's time to move.
- **Floating mini timer.** It stays on top of Outlook, Excel or Teams in Chrome and Edge.
- **Guided breaks.** Desk reset (squats, calf raises), a 5-minute walk, a stair burst, a desk stretch and a post-lunch walk.
- **Keyboard shortcuts.** `Space` starts or pauses, `M` logs "I moved", `S` snoozes, `B` opens breaks, `1`–`4` switch pages.
- **Personal history** that only the employee can see, with GDPR export and account deletion.

**For companies**
- **Organizations, teams and invite links**, with member and admin roles.
- **Single sign-on** with Microsoft Entra ID, Google Workspace, Okta or any OpenID Connect provider. Admins can make SSO mandatory and auto-join company email domains.
- **Company-wide policy:** interval, work hours (the timer starts in the morning and stops after work), workdays, time zone and daily goal. The policy can be locked or left adjustable per person.
- **Branding:** name, logo and accent colour.
- **Anonymous analytics:** participation, breaks per person, goal attainment, busiest hours and team comparison. Small or recently changed groups are always hidden.
- **Microsoft Teams personal tab:** admins can download the manifest from the app.
- **Self-hostable** with Docker Compose. No ads, no trackers.

## Quick start (Docker)

```bash
cp .env.example .env        # set APP_URL, APP_SECRET, POSTGRES_PASSWORD
docker compose up -d --build
```

Put a TLS-terminating reverse proxy (Caddy, Traefik, nginx) in front of `127.0.0.1:3000`. Then open the app and choose *Create an organization*.

## Development

Requirements: Node 20+ and PostgreSQL 14+.

```bash
# API (http://localhost:3100)
cd server && npm install
DATABASE_URL=postgres://postgres@localhost:5432/move30 PORT=3100 APP_URL=http://localhost:3100 npm run dev

# Web (Vite dev server proxies /api to :3100)
cd web && npm install && npm run dev

# Demo organization with 25 people and a month of history
cd server && DEMO_PASSWORD=choose-one npm run seed:demo

# Security regression tests (uses and wipes a throwaway database)
cd server && TEST_DATABASE_URL=postgres://postgres@localhost:5432/move30_test npm test
```

Migrations in `db/migrations` run automatically at startup.

## Project structure

```
server/   Express API: auth, SSO, organizations, analytics (PostgreSQL)
web/      React + Vite single-page app built with Arc components
db/       SQL migrations
docs/     Security audit report
```

## Security and privacy

See [SECURITY.md](SECURITY.md) for the trust model, the audit summary and how to report a vulnerability.

## Credits

- UI components from [Arc](https://github.com/kuratlielia/arc-library) (MIT). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Security review method: [Cloudflare security-audit skill](https://github.com/cloudflare/security-audit-skill).

## License

[MIT](LICENSE)
