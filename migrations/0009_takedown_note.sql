-- Contextual scheduling (JOB B, owner-approved 18 Oct 2026). Additive only.
-- The second booking (porch/party takedown) is never required: requests.takedown_plan (0006)
-- holds 'scheduled' | 'not_sure' | 'customer_handles'; this is the note she types with it.
ALTER TABLE requests ADD COLUMN takedown_note TEXT NOT NULL DEFAULT '';
