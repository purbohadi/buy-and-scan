-- Receipts approved and stored from the app
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  receipt_datetime TEXT,
  vendor TEXT,
  category TEXT,
  description TEXT,
  currency TEXT NOT NULL DEFAULT 'JPY',
  total REAL NOT NULL DEFAULT 0,
  items_json TEXT NOT NULL,
  location_json TEXT,
  image_r2_key TEXT NOT NULL,
  image_public_url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  raw_ai_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_receipts_content_hash ON receipts (content_hash);
CREATE INDEX IF NOT EXISTS idx_receipts_created_at ON receipts (created_at);
