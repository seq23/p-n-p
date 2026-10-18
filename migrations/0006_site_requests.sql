-- Requests live in D1 (docs/admin-console.md, owner-approved 18 Oct 2026). Additive only.
-- The site form (porchandparty901.com/request) writes here; the one real Google Form request
-- is imported here once (scripts/admin/import_form_request.mjs, source 'google_form', its raw
-- row kept, its request_key unchanged so its status, invoice, payments, bookings, notes and
-- checklist stay linked). The Google Sheet is the archive and sync target, never deleted.
CREATE TABLE IF NOT EXISTS requests (
  request_key TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('site','google_form')),
  submitted_at TEXT NOT NULL,                 -- UTC "YYYY-MM-DD HH:MM:SS"
  services TEXT NOT NULL DEFAULT '[]',        -- JSON: SERVICES keys (porch, party, grazing, rentals)
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  dob TEXT NOT NULL DEFAULT '',
  social TEXT NOT NULL DEFAULT '',
  heard TEXT NOT NULL DEFAULT '',
  answers TEXT NOT NULL DEFAULT '[]',         -- site: JSON [{group, label, value}]
  raw_row TEXT,                               -- google_form: JSON {headers, row} exactly as the sheet had it
  id_file TEXT NOT NULL DEFAULT '',           -- google_form: the Drive link the form wrote (shown as today)
  id_object TEXT,                             -- site: key of the photo in the private R2 bucket (binding IDS)
  id_type TEXT,
  id_size INTEGER,
  id_deleted_at TEXT,                         -- "Delete this ID" (manual only, never automatic)
  agreed_at TEXT,                             -- rules checkbox: when, which version, typed name, IP
  rules_version TEXT,
  agreed_name TEXT,
  agreed_ip TEXT,
  takedown_plan TEXT CHECK (takedown_plan IS NULL OR takedown_plan IN ('scheduled','not_sure','customer_handles')),
  referral_code TEXT UNIQUE,                  -- this customer's own /r/<code>
  referred_by TEXT,                           -- the code they arrived with (another request's referral_code)
  receipt_id TEXT UNIQUE,                     -- the unguessable id of their "request received" page
  robot_check TEXT NOT NULL DEFAULT '',       -- 'turnstile' | 'no-js' (sent without the robot check)
  is_test INTEGER NOT NULL DEFAULT 0,
  name_norm TEXT NOT NULL DEFAULT '',
  phone_digits TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_requests_submitted ON requests(submitted_at);
CREATE INDEX IF NOT EXISTS idx_requests_name_norm ON requests(name_norm);
CREATE INDEX IF NOT EXISTS idx_requests_referred ON requests(referred_by);

-- What happened to a request, in words, newest last: rules agreed, ID deleted (who/when),
-- hold changes. Never shown to customers.
CREATE TABLE IF NOT EXISTS request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_key TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  who TEXT NOT NULL DEFAULT '',
  what TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_request_events_key ON request_events(request_key);

-- Request-form submissions per IP (hashed), for the per-IP rate limit.
CREATE TABLE IF NOT EXISTS form_attempts (
  ip_hash TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_form_attempts ON form_attempts(ip_hash, ts);

-- Rental holds (owner, 18 Oct 2026): a site rental booking holds its games for 24 hours
-- (Settings: hold_hours) until the deposit arrives. One row per request. state: held ->
-- confirmed (deposit received) | expired (ran out) | released (by hand). by_hand = 1 means
-- "Keep holding — I'll handle it": no automatic expiry, no end time. reminded_for is the
-- end time the reminder was sent for, so it never fires twice for the same end time.
CREATE TABLE IF NOT EXISTS holds (
  request_key TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'held' CHECK (state IN ('held','confirmed','expired','released')),
  until TEXT,                                 -- UTC "YYYY-MM-DD HH:MM:SS"; NULL when held by hand
  by_hand INTEGER NOT NULL DEFAULT 0,
  reminded_for TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_holds_state ON holds(state, until);
