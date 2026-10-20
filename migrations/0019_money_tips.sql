-- Calm Money tab (owner-approved 19 Oct 2026; functions/_lib/money.mjs, views-money.mjs).
-- Additive only: two new tables, no existing row changes.
--
-- 1. Tips: money a customer gave on top of the invoice. Kept apart from payments on purpose:
--    a tip is never part of an invoice balance, never "owed", never on the invoice, and is
--    totalled on Money as its own line. Removing a tip sets removed_at (the row stays, so its
--    history stays); every change is written to money_history.
CREATE TABLE IF NOT EXISTS tips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  date TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','zelle','cashapp','other')),
  request_key TEXT,
  invoice_id INTEGER,
  job_label TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  removed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tips_date ON tips(date);
CREATE INDEX IF NOT EXISTS idx_tips_request ON tips(request_key);

-- 2. What changed on a tip or an expense, and when (shown under "History" on its page).
--    An expense delete keeps its history row, so a deleted expense is still on record.
CREATE TABLE IF NOT EXISTS money_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item TEXT NOT NULL CHECK (item IN ('tip','expense')),
  item_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_money_history_item ON money_history(item, item_id);
