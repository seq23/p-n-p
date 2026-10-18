-- Money tab, year-end summary, expenses and the Google Sheet sync (docs/admin-console.md).
-- Additive only.

-- 1. A payment row is now one of: a payment from the customer, a refund to them (damage
--    deposit or other), or part of the damage deposit kept for damage (income, its own line).
ALTER TABLE payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment','refund','deposit_kept'));

-- 2. Expenses with their receipt (original in the private R2 bucket pnp-receipts). Every
--    receipt read by Workers AI lands as needs_check; only 'saved' rows count in totals.
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_key TEXT,
  receipt_type TEXT NOT NULL DEFAULT '',
  vendor TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  total_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'Other',
  payment_method TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  ai_raw_json TEXT NOT NULL DEFAULT '',
  ai_confidence TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'needs_check' CHECK (status IN ('needs_check','saved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

-- 3. Google Sheet sync retries: one row per failed sync, cleared when a sync succeeds.
CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  what TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  tries INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 4. Workers AI receipt reads per Memphis day, capped well inside the free daily allocation.
CREATE TABLE IF NOT EXISTS ai_usage (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

-- 5. The secret the pnp-mailer cron uses to ask the site for its daily full Google Sheet
--    resync (POST /api/sync/<token>; a wrong token is 404). Random, made here once.
INSERT OR IGNORE INTO settings (key, value) VALUES ('sync_token', lower(hex(randomblob(32))));
