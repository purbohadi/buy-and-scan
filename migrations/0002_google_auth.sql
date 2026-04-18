-- Per-user receipt isolation and OAuth PKCE state
ALTER TABLE receipts ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_receipts_user_hash ON receipts (user_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_receipts_user_created ON receipts (user_id, created_at);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
