-- Security fixes after audit run-1.

-- Bind each SSO identity to the issuer that vouched for it.
ALTER TABLE users ADD COLUMN sso_issuer text;
UPDATE users u SET sso_issuer = o.sso_issuer FROM organizations o WHERE u.org_id = o.id AND u.sso_sub IS NOT NULL;

-- When did the person join their current team? Team statistics only use breaks taken after this moment,
-- and only count people who have been in the team for a while (see analytics.js).
ALTER TABLE users ADD COLUMN team_since timestamptz NOT NULL DEFAULT now();
UPDATE users SET team_since = created_at;

CREATE INDEX invites_created_by ON invites (created_by) WHERE used_at IS NULL;
