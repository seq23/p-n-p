-- Inspiration photos on /request (owner, 5 Nov 2026: "allow people to upload photo inspiration").
-- JSON array of private R2 keys (binding IDS, prefix inspo/), up to 5. Additive only.
ALTER TABLE requests ADD COLUMN inspo_objects TEXT;
