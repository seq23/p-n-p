-- Customer messages (owner, 18 Oct 2026): the confirmation when a deposit comes in, the
-- thank-you after the job, and the hold reminder. Texts are free sms: links Valerie taps;
-- emails go from hello@ through pnp-mailer. Each timestamp means "done once": a message is
-- never sent twice. Additive only.
ALTER TABLE requests ADD COLUMN confirm_emailed_at TEXT;
ALTER TABLE requests ADD COLUMN confirmed_texted_at TEXT;
ALTER TABLE requests ADD COLUMN thankyou_emailed_at TEXT;
ALTER TABLE requests ADD COLUMN thankyou_texted_at TEXT;
ALTER TABLE requests ADD COLUMN thankyou_skip INTEGER NOT NULL DEFAULT 0;
ALTER TABLE requests ADD COLUMN hold_texted_at TEXT;
