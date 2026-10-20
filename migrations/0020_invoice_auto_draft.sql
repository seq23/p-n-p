-- Invoice auto draft (owner-approved mock-up "Invoices: total and deposit broken out", 20 Oct 2026).
-- Additive only: nothing existing is changed, every existing row reads NULL.
-- invoices.auto_draft    1 = the draft was made by itself when the request arrived (website form or
--                        phone booking); NULL = made by hand (every invoice before this migration).
--                        Only an auto draft that was never sent is rebuilt when "What they want" changes.
-- invoice_lines.auto     the kind of starting line the auto draft wrote ('start', 'food', 'takedown',
--                        'rental', 'porch', 'deposit'); NULL = a line Valerie typed or changed by hand,
--                        which a rebuild always keeps.
ALTER TABLE invoices ADD COLUMN auto_draft INTEGER;
ALTER TABLE invoice_lines ADD COLUMN auto TEXT;
