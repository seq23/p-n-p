-- IDs delete themselves 90 days after they are ready (owner decision and approved mock-up
-- "ID Auto Delete", 20 Oct 2026; functions/_lib/id-auto.mjs, docs/admin-console.md).
--   requests.id_ready_since   when the ID first became ready to delete (paid in full and, for a
--                             rental, the games back; or the job cancelled). Set by the pnp-mailer
--                             hourly cron and the main page; cleared if it stops being ready. IDs
--                             already ready start their 90 days on the day this goes live.
--   requests.id_keep_until    "Keep this ID longer": a Memphis date (YYYY-MM-DD) it is kept until.
--   requests.id_keep_forever  1 = "Keep until I delete it myself": never deleted by itself.
--   requests.id_deleted_auto  1 = the cron deleted it ("ID: deleted automatically on <date>").
-- Additive only: no existing row is changed. Google-form IDs (Drive) are never deleted by the cron.
ALTER TABLE requests ADD COLUMN id_ready_since TEXT;
ALTER TABLE requests ADD COLUMN id_keep_until TEXT;
ALTER TABLE requests ADD COLUMN id_keep_forever INTEGER NOT NULL DEFAULT 0;
ALTER TABLE requests ADD COLUMN id_deleted_auto INTEGER NOT NULL DEFAULT 0;
