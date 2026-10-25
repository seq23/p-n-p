-- "Deposit due by" (owner, 25 Oct 2026): with "Other deposit" the deposit can be due by a later
-- day instead of now. NULL = due now, exactly as every invoice before this. Additive only:
-- existing rows keep NULL and read as before.
ALTER TABLE invoices ADD COLUMN deposit_due_date TEXT;
