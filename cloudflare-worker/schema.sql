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


-- Payment orders are created only by the authenticated Worker API. Proof files are sent to the admin in Telegram and are not stored in D1.
CREATE TABLE IF NOT EXISTS payment_orders (
  order_id TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL,
  nickname TEXT NOT NULL,
  email TEXT NOT NULL,
  telegram_username TEXT,
  plan_code TEXT NOT NULL CHECK (plan_code IN ('free', 'pro', 'unlimited')),
  plan_name TEXT NOT NULL,
  amount_uah INTEGER NOT NULL CHECK (amount_uah >= 0),
  status TEXT NOT NULL CHECK (status IN ('awaiting_payment', 'proof_processing', 'pending_review', 'approved', 'rejected', 'expired')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  proof_submitted_at INTEGER,
  reviewed_at INTEGER,
  review_note TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_account ON payment_orders(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status, expires_at);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  order_id TEXT NOT NULL UNIQUE,
  plan_code TEXT NOT NULL CHECK (plan_code IN ('free', 'pro', 'unlimited')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES payment_orders(order_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_account ON subscriptions(account_id, status, ends_at);


-- Versioned records of explicit acceptance of the privacy notice for each collection flow.
CREATE TABLE IF NOT EXISTS consent_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER,
  ticket_id TEXT,
  order_id TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('account_registration', 'support_ticket', 'payment_order', 'payment_proof')),
  policy_version TEXT NOT NULL,
  consented_at INTEGER NOT NULL,
  CHECK ((account_id IS NOT NULL) + (ticket_id IS NOT NULL) + (order_id IS NOT NULL) = 1),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES payment_orders(order_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_consents_account ON consent_records(account_id, consented_at);
CREATE INDEX IF NOT EXISTS idx_consents_ticket ON consent_records(ticket_id, consented_at);
CREATE INDEX IF NOT EXISTS idx_consents_order ON consent_records(order_id, consented_at);


-- Telegram copies of support notifications and proof files; used for best-effort deletion requests.
CREATE TABLE IF NOT EXISTS telegram_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT,
  order_id TEXT,
  chat_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK ((ticket_id IS NOT NULL) + (order_id IS NOT NULL) = 1),
  FOREIGN KEY (ticket_id) REFERENCES tickets(ticket_id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES payment_orders(order_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_ticket ON telegram_deliveries(ticket_id);
CREATE INDEX IF NOT EXISTS idx_telegram_deliveries_order ON telegram_deliveries(order_id);
