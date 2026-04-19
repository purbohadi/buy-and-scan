-- Per-user Google OAuth refresh token and auto-created receipt spreadsheet
CREATE TABLE IF NOT EXISTS google_accounts (
  user_id TEXT PRIMARY KEY,
  refresh_token_enc TEXT,
  spreadsheet_id TEXT,
  spreadsheet_url TEXT,
  updated_at TEXT NOT NULL
);

-- 0 = default OAuth prompt; 1 = force consent to obtain refresh_token
ALTER TABLE oauth_states ADD COLUMN force_consent INTEGER NOT NULL DEFAULT 0;
