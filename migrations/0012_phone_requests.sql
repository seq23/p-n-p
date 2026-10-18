-- Phone requests (owner, 18 Oct 2026; functions/_lib/phone-requests.mjs). "Add a booking" with a
-- customer now makes a request with source 'phone', so a phone-call booking lands on Requests.
--   requests.source       CHECK widened to ('site','google_form','phone'). SQLite cannot alter a
--                         CHECK, so the table is rebuilt: every column copied by name, every row
--                         kept, the three indexes and the two UNIQUE columns recreated.
--   bookings.calendar_note 1 = "Just a calendar note (no customer)": a hand-added block with no
--                         request, which the phone backfill never turns into a request.
-- Additive: no row is dropped or changed; no other table references requests by foreign key.
CREATE TABLE requests_v12 (
  request_key TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('site','google_form','phone')),
  submitted_at TEXT NOT NULL,
  services TEXT NOT NULL DEFAULT '[]',
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  dob TEXT NOT NULL DEFAULT '',
  social TEXT NOT NULL DEFAULT '',
  heard TEXT NOT NULL DEFAULT '',
  answers TEXT NOT NULL DEFAULT '[]',
  raw_row TEXT,
  id_file TEXT NOT NULL DEFAULT '',
  id_object TEXT,
  id_type TEXT,
  id_size INTEGER,
  id_deleted_at TEXT,
  agreed_at TEXT,
  rules_version TEXT,
  agreed_name TEXT,
  agreed_ip TEXT,
  takedown_plan TEXT CHECK (takedown_plan IS NULL OR takedown_plan IN ('scheduled','not_sure','customer_handles')),
  referral_code TEXT UNIQUE,
  referred_by TEXT,
  receipt_id TEXT UNIQUE,
  robot_check TEXT NOT NULL DEFAULT '',
  is_test INTEGER NOT NULL DEFAULT 0,
  name_norm TEXT NOT NULL DEFAULT '',
  phone_digits TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirm_emailed_at TEXT,
  confirmed_texted_at TEXT,
  thankyou_emailed_at TEXT,
  thankyou_texted_at TEXT,
  thankyou_skip INTEGER NOT NULL DEFAULT 0,
  hold_texted_at TEXT,
  takedown_note TEXT NOT NULL DEFAULT '',
  takedown_date TEXT NOT NULL DEFAULT '',
  details_edits TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO requests_v12 (request_key, source, submitted_at, services, name, email, phone, dob, social, heard, answers, raw_row, id_file, id_object, id_type, id_size,
  id_deleted_at, agreed_at, rules_version, agreed_name, agreed_ip, takedown_plan, referral_code, referred_by, receipt_id, robot_check, is_test, name_norm, phone_digits,
  created_at, confirm_emailed_at, confirmed_texted_at, thankyou_emailed_at, thankyou_texted_at, thankyou_skip, hold_texted_at, takedown_note, takedown_date, details_edits)
SELECT request_key, source, submitted_at, services, name, email, phone, dob, social, heard, answers, raw_row, id_file, id_object, id_type, id_size,
  id_deleted_at, agreed_at, rules_version, agreed_name, agreed_ip, takedown_plan, referral_code, referred_by, receipt_id, robot_check, is_test, name_norm, phone_digits,
  created_at, confirm_emailed_at, confirmed_texted_at, thankyou_emailed_at, thankyou_texted_at, thankyou_skip, hold_texted_at, takedown_note, takedown_date, details_edits
FROM requests;
DROP TABLE requests;
ALTER TABLE requests_v12 RENAME TO requests;
CREATE INDEX IF NOT EXISTS idx_requests_submitted ON requests(submitted_at);
CREATE INDEX IF NOT EXISTS idx_requests_name_norm ON requests(name_norm);
CREATE INDEX IF NOT EXISTS idx_requests_referred ON requests(referred_by);

ALTER TABLE bookings ADD COLUMN calendar_note INTEGER NOT NULL DEFAULT 0;
