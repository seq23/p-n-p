-- Additive: existing requests remain home requests; no invoice or sent copy is changed.
ALTER TABLE requests ADD COLUMN corporate INTEGER NOT NULL DEFAULT 0 CHECK (corporate IN (0,1));
CREATE TABLE outreach_messages (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL,
  email TEXT NOT NULL,
  domain TEXT NOT NULL,
  subject TEXT NOT NULL,
  text TEXT NOT NULL,
  in_reply_to TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('first','followup')),
  day TEXT NOT NULL,
  at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','sent','uncertain')),
  message_id TEXT
);
CREATE UNIQUE INDEX outreach_prospect_once ON outreach_messages(prospect_id, kind);
CREATE UNIQUE INDEX outreach_email_once ON outreach_messages(email, kind);
CREATE INDEX outreach_daily ON outreach_messages(day, kind);
CREATE TABLE outreach_blocks (
  address TEXT NOT NULL,
  domain TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('suppressed','taken_over')),
  at TEXT NOT NULL,
  PRIMARY KEY (address, kind)
);
CREATE INDEX outreach_block_domain ON outreach_blocks(domain, kind);
CREATE TABLE outreach_inbound (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bounce','ooo','opt_out','reply')),
  at TEXT NOT NULL,
  raw_key TEXT NOT NULL,
  forwarded_at TEXT
);
