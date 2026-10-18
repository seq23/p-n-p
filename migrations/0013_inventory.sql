-- Rentals inventory (owner-approved 18 Oct 2026; functions/_lib/inventory.mjs, docs/admin-console.md
-- "Inventory"). Valerie adds, edits, removes and brings back rental items from Settings ->
-- Inventory. D1 is the live copy the admin and the /request form read straight away; every save
-- publishes it back into data/rentals/games.json through the Inventory Publish workflow, which
-- rebuilds the public pages (about 5 minutes).
--   inventory_items      one row per item: its games.json section ('games', 'extras', 'adminItems'),
--                        its order and its games.json object (data, JSON). Seeded from the bundled
--                        games.json on first use. photo_sha / photo_live: a photo uploaded in the
--                        admin (inventory_photos) and whether the website has it yet.
--   inventory_meta       rev (bumped on every save), dirty (a save not yet live), rates (the game
--                        day / weekend price) and base_version (the website's inventory version).
--   inventory_photos     uploaded photos, EXIF stripped, by content hash (served to the publish
--                        workflow at /api/inventory/photo/<sha>).
--   inventory_publishes  one row per website update: queued / running / deploying / live / failed /
--                        superseded / needs_key, with the plain-words detail Settings shows.
--   inventory_log        what changed, when (add, edit, remove, bring back).
-- Additive: new tables only; nothing existing is read or changed.
CREATE TABLE IF NOT EXISTS inventory_items (
  slug TEXT PRIMARY KEY,
  section TEXT NOT NULL CHECK (section IN ('games','extras','adminItems')),
  position INTEGER NOT NULL,
  data TEXT NOT NULL,
  photo_sha TEXT,
  photo_live INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS inventory_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory_photos (
  sha TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS inventory_publishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','deploying','live','failed','superseded','needs_key')),
  detail TEXT NOT NULL DEFAULT '',
  what TEXT NOT NULL DEFAULT '',
  photos TEXT NOT NULL DEFAULT '[]',
  run_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  live_at TEXT
);
CREATE TABLE IF NOT EXISTS inventory_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
