-- A copy of every invoice email that went out (owner, 25 Oct 2026): the exact HTML, the text and
-- the PDF live in the private R2 bucket pnp-receipts under sent-invoices/<invoice id>/<stamp>/;
-- this table lists them for "What we sent ✉ <date time>" on the invoice. Additive only.
CREATE TABLE IF NOT EXISTS invoice_sent_copies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  sent_at TEXT NOT NULL,
  from_email TEXT,
  to_email TEXT,
  bcc TEXT,
  subject TEXT,
  r2_prefix TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS invoice_sent_copies_invoice ON invoice_sent_copies (invoice_id, id);
