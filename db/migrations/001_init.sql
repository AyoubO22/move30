-- Move30 schema. One organization per company; every user belongs to exactly one organization.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  accent          text NOT NULL DEFAULT 'green',
  logo_url        text,
  policy          jsonb NOT NULL DEFAULT '{}'::jsonb,
  allowed_domains text[] NOT NULL DEFAULT '{}',
  sso_enabled     boolean NOT NULL DEFAULT false,
  sso_enforced    boolean NOT NULL DEFAULT false,
  sso_issuer      text,
  sso_client_id   text,
  sso_client_secret_enc text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id       uuid REFERENCES teams(id) ON DELETE SET NULL,
  email         text NOT NULL,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  password_hash text,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  settings      jsonb NOT NULL DEFAULT '{}'::jsonb,
  sso_sub       text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_sso_sub ON users (org_id, sso_sub) WHERE sso_sub IS NOT NULL;
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE INDEX users_org ON users (org_id);

CREATE TABLE sessions (
  token_hash  bytea PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE invites (
  token_hash  bytea PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       text,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  team_id     uuid REFERENCES teams(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX invites_org ON invites (org_id);

CREATE TABLE breaks (
  id        bigserial PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  taken_at  timestamptz NOT NULL DEFAULT now(),
  minutes   numeric(5,1) NOT NULL CHECK (minutes > 0 AND minutes <= 30),
  routine   text
);
CREATE INDEX breaks_user_time ON breaks (user_id, taken_at);
CREATE INDEX breaks_org_time ON breaks (org_id, taken_at);

CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
