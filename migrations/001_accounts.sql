-- Аккаунты Discord/Telegram. Храним минимум: никаких телефонов, почты и токенов провайдеров.
-- provider_key = HMAC-SHA256(AUTH_SECRET, provider:id) — без секрета сервера не сопоставляется с реальным аккаунтом.
CREATE TABLE accounts (
  id            uuid PRIMARY KEY,
  provider      text NOT NULL CHECK (provider IN ('discord', 'telegram')),
  provider_key  text NOT NULL CHECK (length(provider_key) = 64),
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 64),
  username      text CHECK (length(username) <= 64),
  avatar        bytea CHECK (octet_length(avatar) <= 131072),
  avatar_type   text CHECK (avatar_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_key)
);

-- В базе только SHA-256 от токена сессии; сам токен живёт в HttpOnly cookie.
CREATE TABLE sessions (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_account_idx ON sessions (account_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
