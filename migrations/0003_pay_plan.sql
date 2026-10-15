-- How the customer pays: 'half' (deposit of half now, rest by the due date),
-- 'full' (the whole total by the due date) or 'custom' (a typed deposit now).
ALTER TABLE invoices ADD COLUMN pay_plan TEXT NOT NULL DEFAULT 'half';
UPDATE invoices SET pay_plan = 'full'
  WHERE deposit_due_cents > 0 AND deposit_due_cents >= (SELECT COALESCE(SUM(ROUND(qty * unit_cents)), 0) FROM invoice_lines l WHERE l.invoice_id = invoices.id);
UPDATE invoices SET pay_plan = 'custom'
  WHERE pay_plan = 'half' AND deposit_due_cents <> ROUND((SELECT COALESCE(SUM(ROUND(qty * unit_cents)), 0) FROM invoice_lines l WHERE l.invoice_id = invoices.id) / 2.0);
