-- "Change anything on this request" (owner, 18 Oct 2026; functions/_lib/admin-edit.mjs).
--   requests.details_edits  JSON of the customer details Valerie corrected by hand
--                           ({name, phone, email, address, notes}); fromRow lays them over what
--                           the form sent, so raw_row stays exactly as the sheet had it.
-- Additive only. Every other edit reuses existing columns (bookings.date/time/done_at,
-- request_status.job_done_at, rental_returns.returned_at, invoice_lines, payments.voided_at).
ALTER TABLE requests ADD COLUMN details_edits TEXT NOT NULL DEFAULT '{}';
