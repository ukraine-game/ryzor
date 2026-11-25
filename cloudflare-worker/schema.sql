CREATE TABLE IF NOT EXISTS tickets (
  ticket_id TEXT PRIMARY KEY,
  access_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  email TEXT,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user', 'admin')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_ticket_id ON messages(ticket_id, id);
CREATE INDEX IF NOT EXISTS idx_tickets_updated_at ON tickets(updated_at DESC);

CREATE TABLE IF NOT EXISTS launch_sessions (
  session_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  game TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  verified_at INTEGER,
  telegram_user_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_launch_token_hash ON launch_sessions(token_hash);

CREATE TABLE IF NOT EXISTS request_limits (
  subject_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (subject_hash, action)
);

CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at INTEGER NOT NULL
);


-- RYZOR accounts: Google identity is verified server-side; passwords are stored only as salted PBKDF2 hashes.
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  full_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 600000,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_account ON auth_sessions(account_id);
