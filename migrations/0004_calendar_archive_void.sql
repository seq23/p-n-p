-- Calendar, "Put away" (archive) and Void (docs/admin-console.md). Additive: every existing
-- row is kept. Nothing here deletes data or touches the Google Sheet.
--
-- 1. request_status takes the owner-approved steps (18 Oct 2026): new -> invoiced ->
--    deposit_paid -> scheduled -> job_done -> paid, plus void off the line. 'done' becomes
--    'job_done' (with job_done_at); "Put away" is the archived_at flag, not a status;
--    prev_status is what a request goes back to when it is taken off the calendar or "Undo
--    returned" is tapped. SQLite cannot change a CHECK constraint in place, so the table is
--    rebuilt and every row is copied across.
CREATE TABLE request_status_v4 (
  request_key TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','invoiced','deposit_paid','scheduled','job_done','paid','void')),
  invoice_id INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at TEXT,
  prev_status TEXT,
  job_done_at TEXT
);
INSERT INTO request_status_v4 (request_key, status, invoice_id, updated_at, archived_at, prev_status, job_done_at)
  SELECT request_key, CASE status WHEN 'done' THEN 'job_done' ELSE status END, invoice_id, updated_at, NULL, NULL,
    CASE status WHEN 'done' THEN updated_at ELSE NULL END
  FROM request_status;
DROP TABLE request_status;
ALTER TABLE request_status_v4 RENAME TO request_status;

-- 2. Bookings for all four services (functions/_lib/kinds.mjs): rental pickups/returns, porch
--    installs/takedowns, party setups/takedowns, grazing table setups/pickups. Rows made from an invoice or scheduled from a request
--    carry its request_key and are upserted by (request_key, kind), so re-sending never duplicates.
--    Manual bookings have no request_key (NULLs never collide in a UNIQUE index).
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_key TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('rental_pickup','rental_return','porch_install','porch_takedown','party_setup','party_takedown','grazing_setup','grazing_pickup','other')),
  date TEXT NOT NULL,
  time TEXT,
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL DEFAULT '',
  invoice_id INTEGER,
  email TEXT NOT NULL DEFAULT '',
  name_norm TEXT NOT NULL DEFAULT '',   -- lower case, accents stripped: "Find a customer"
  phone_digits TEXT NOT NULL DEFAULT '',
  edited_by_hand INTEGER NOT NULL DEFAULT 0,
  reminded_at TEXT,          -- she tapped "Text reminder" / "Mark reminded"
  email_reminded_at TEXT,    -- the pnp-mailer cron emailed the day-before reminder
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_request_kind ON bookings(request_key, kind);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_invoice ON bookings(invoice_id);
CREATE INDEX IF NOT EXISTS idx_bookings_name_norm ON bookings(name_norm);
CREATE INDEX IF NOT EXISTS idx_bookings_phone_digits ON bookings(phone_digits);

-- 3. Rental check-in ("Mark returned"). One row per rental: return_key is the request_key, or
--    "booking:<id>" for a rental typed in by hand. items is JSON
--    [{"name":"Giant Connect Four","back":true,"damaged":false,"note":""}]. Undo clears
--    returned_at and keeps the row (nothing is deleted).
CREATE TABLE IF NOT EXISTS rental_returns (
  return_key TEXT PRIMARY KEY,
  request_key TEXT,
  booking_id INTEGER,
  returned_at TEXT,
  items TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  damaged INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rental_returns_request ON rental_returns(request_key);

-- Invoices get the same normalised name for "Find a customer"; existing rows are backfilled
-- with lower() here (accents are folded by the app on every write from now on).
ALTER TABLE invoices ADD COLUMN name_norm TEXT NOT NULL DEFAULT '';
UPDATE invoices SET name_norm = lower(trim(customer_name));
CREATE INDEX IF NOT EXISTS idx_invoices_name_norm ON invoices(name_norm);

-- 4. Payments: exact amounts, so a balance is never guessed from a status chip. "Mark deposit
--    received" records the deposit asked for; "Mark paid in full" records whatever is left.
--    "That was a mistake" sets voided_at (rows are never deleted). Existing invoices already
--    marked paid get the matching row so their balances read right from day one.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  received_on TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  voided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
INSERT INTO payments (invoice_id, amount_cents, received_on, method, note)
  SELECT id, deposit_due_cents, substr(updated_at, 1, 10), 'unknown (before payments were tracked)', 'deposit' FROM invoices WHERE status = 'deposit_paid';
INSERT INTO payments (invoice_id, amount_cents, received_on, method, note)
  SELECT id, COALESCE((SELECT SUM(ROUND(qty * unit_cents)) FROM invoice_lines l WHERE l.invoice_id = invoices.id), 0), substr(updated_at, 1, 10), 'unknown (before payments were tracked)', 'paid in full'
  FROM invoices WHERE status = 'paid';
-- A request marked paid (or deposit paid) by hand while its invoice still reads sent: record
-- the matching payment once, so its balance reads right too.
INSERT INTO payments (invoice_id, amount_cents, received_on, method, note)
  SELECT i.id, COALESCE((SELECT SUM(ROUND(qty * unit_cents)) FROM invoice_lines l WHERE l.invoice_id = i.id), 0), substr(rs.updated_at, 1, 10), 'unknown (before payments were tracked)', 'paid in full'
  FROM request_status rs JOIN invoices i ON i.id = rs.invoice_id
  WHERE rs.status = 'paid' AND i.status <> 'void' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id);
INSERT INTO payments (invoice_id, amount_cents, received_on, method, note)
  SELECT i.id, i.deposit_due_cents, substr(rs.updated_at, 1, 10), 'unknown (before payments were tracked)', 'deposit'
  FROM request_status rs JOIN invoices i ON i.id = rs.invoice_id
  WHERE rs.status = 'deposit_paid' AND i.status <> 'void' AND i.deposit_due_cents > 0 AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id);

-- 5. Notes on a booking (internal only: never in customer emails, texts, invoices or PDFs).
--    Keyed to the booking AND its request, so taking a request off the calendar and putting it
--    back keeps its notes.
CREATE TABLE IF NOT EXISTS booking_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER,
  request_key TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_booking_notes_booking ON booking_notes(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_notes_request ON booking_notes(request_key);
