-- Channel source tags (owner, 22 Oct 2026): every website request records where it came from.
--   requests.source_tag   the /request?src=<tag> value (mailer-38117, hotel, hoa, school, facebook,
--                         instagram, tiktok, pinterest, google ...), cleaned to a-z 0-9 "-" and at
--                         most 40 characters (request-form.mjs cleanSrc); '' when none was given.
-- Additive only: no existing row is changed (old rows read ''). Not shown in /admin yet.
ALTER TABLE requests ADD COLUMN source_tag TEXT NOT NULL DEFAULT '';
