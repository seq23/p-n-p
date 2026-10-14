-- Online walk-through checklist per form request (docs/admin-console.md).
CREATE TABLE IF NOT EXISTS request_checklist (
  request_key TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Walk-through photos: up to 10 per request, each <= 1.5 MB after the phone downscales it.
CREATE TABLE IF NOT EXISTS checklist_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_checklist_photos_request ON checklist_photos(request_key);
