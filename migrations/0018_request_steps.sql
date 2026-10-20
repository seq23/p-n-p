-- Step cards on Requests (owner-approved 19 Oct 2026; functions/_lib/steps.mjs). Every step on a
-- card is DERIVED from what already happened (invoice sent, payments on Money, bookings marked
-- done, returns, the takedown). Only two facts had nowhere to live, and they live here:
--   called_at     Valerie tapped "I've talked to them" (step 1, Called back)
--   confirmed_at  she answered "Yes, book it": the request's date stops being a tentative,
--                 outlined "Requested · not confirmed" chip and becomes a solid booking.
-- Additive: a new table; no existing row changes. A request she had already put on the calendar
-- herself (status Scheduled) counts as called and confirmed (backfill below), so nothing she
-- booked before this ships turns tentative. Deposits, payments and done jobs confirm by
-- themselves (derived in steps.mjs, never stored here).
CREATE TABLE IF NOT EXISTS request_steps (
  request_key TEXT PRIMARY KEY,
  called_at TEXT,
  confirmed_at TEXT,
  how TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO request_steps (request_key, called_at, confirmed_at, how)
  SELECT request_key, datetime('now'), datetime('now'), 'scheduled before step cards' FROM request_status WHERE status = 'scheduled';
