-- Request cards + admin homepage (JOB B, owner-approved 18 Oct 2026). Additive only.
-- "Email a reminder" on Money's Not paid yet list logs when it last went out, per invoice.
ALTER TABLE invoices ADD COLUMN reminded_at TEXT;
