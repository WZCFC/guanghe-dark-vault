CREATE TABLE vault_accounts (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  verifier TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE vault_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES vault_accounts(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX vault_sessions_expiry ON vault_sessions(expires);
--> statement-breakpoint
CREATE TABLE vault_auth_attempts (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX vault_auth_attempts_expiry ON vault_auth_attempts(expires);
--> statement-breakpoint
CREATE TABLE vault_feedback (
  id TEXT PRIMARY KEY,
  rating INTEGER NOT NULL,
  friction TEXT NOT NULL,
  note TEXT NOT NULL,
  mode TEXT NOT NULL,
  created INTEGER NOT NULL
);
