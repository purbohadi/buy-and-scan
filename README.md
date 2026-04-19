# scan-and-parse

Progressive web app for scanning receipts with your phone camera, parsing them with **Cloudflare Workers AI** (Llama 3.2 Vision), reviewing and editing extracted fields, then saving structured data to **D1**, the receipt image to **R2**, and appending rows to a **Google Sheet stored in the user’s Google Drive** (created automatically on first successful OAuth with Drive/Sheets scopes).

## Features

- **Google sign-in** (OAuth 2.0 with PKCE): session cookie; APIs require a signed-in user; data is scoped per Google `sub` in D1 and R2 keys.
- **Google Drive + Sheets (per user)**: OAuth includes `drive.file` and `spreadsheets`. On first sign-in, if Google returns a **refresh token**, the Worker creates a new spreadsheet in the user’s Drive, writes a header row on tab **Receipts**, and stores the spreadsheet id (refresh token is **encrypted** with `AUTH_SESSION_SECRET` in D1). Each approved receipt appends a row via the **Sheets API**.
- **Reconnect Drive/Sheets**: If Google did not return a refresh token on first login (common for returning Google users), use **Connect Google Drive & Sheet** so Google shows **consent** again and issues a refresh token.
- PWA installable on your home screen; camera capture via file input (`capture="environment"`).
- **Parse** uploads the image once; the Worker hashes the bytes (SHA-256) for duplicate detection (per user).
- **Duplicate guard**: `409` on submit until “Confirm duplicate” if the same image was already stored for that user.
- **Receipt AI provider** (optional): default is **Cloudflare Workers AI** (Llama 3.2 Vision). Set `RECEIPT_AI_PROVIDER=openai` or `openrouter` to parse receipts with **OpenAI** or **OpenRouter** instead (same JSON schema).

## Receipt parsing: OpenAI or OpenRouter (optional)

Default: **`RECEIPT_AI_PROVIDER`** unset or `workers` → uses the bound Workers AI model (no extra API key).

| Variable | When |
|----------|------|
| `RECEIPT_AI_PROVIDER` | `openai` or `openrouter` to use external vision APIs. |
| `OPENAI_API_KEY` | Required if `RECEIPT_AI_PROVIDER=openai`. |
| `OPENROUTER_API_KEY` | Required if `RECEIPT_AI_PROVIDER=openrouter`. |
| `RECEIPT_VISION_MODEL` | Optional. Defaults: OpenAI `gpt-4o-mini`, OpenRouter `openai/gpt-4o-mini`. Use any vision-capable model id your provider supports. |
| `OPENAI_BASE_URL` | Optional; default `https://api.openai.com/v1` (Azure OpenAI: set to your resource `.../openai/deployments/...` and matching model deployment name). |
| `OPENROUTER_BASE_URL` | Optional; default `https://openrouter.ai/api/v1`. |

```bash
npx wrangler secret put OPENAI_API_KEY
# or
npx wrangler secret put OPENROUTER_API_KEY
```

Set `RECEIPT_AI_PROVIDER` via `wrangler.toml` / dashboard vars or (local) `.dev.vars`.

## Google Cloud setup

1. Create an OAuth **Web application** client.
2. Enable APIs: **Google Drive API** and **Google Sheets API** for the same project.
3. OAuth consent screen: add scopes **…/auth/drive.file** and **…/auth/spreadsheets** (and the default openid/email/profile).
4. **Authorized redirect URIs** (full URL with path):  
   `https://<your-worker-host>/api/auth/callback`  
   and for local Wrangler: `http://127.0.0.1:8787/api/auth/callback`
5. **Authorized JavaScript origins** (origin only, no path, no trailing `/`):  
   `https://<your-worker-host>`, `http://localhost:5173`, `http://127.0.0.1:5173`, etc.

## Local development

1. `npm install`
2. Create Cloudflare resources (once per account):

   ```bash
   npx wrangler d1 create scan-and-parse-db
   npx wrangler r2 bucket create scan-and-parse-receipts
   ```

   Copy the D1 `database_id` into `wrangler.jsonc` (replace `REPLACE_WITH_D1_ID_AFTER_CREATION`).

3. Apply migrations:

   ```bash
   npx wrangler d1 migrations apply scan-and-parse-db --local
   npx wrangler d1 migrations apply scan-and-parse-db --remote
   ```

4. Copy `.dev.vars.example` → `.dev.vars` and set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SESSION_SECRET`.

5. Run the API and the Vite dev server (Vite proxies `/api` to Wrangler on port 8787):

   ```bash
   npm run dev
   ```

   Open http://localhost:5173

## Deploy

```bash
npm run deploy
```

Secrets:

```bash
npx wrangler secret put AUTH_SESSION_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# Optional external receipt AI:
# npx wrangler secret put OPENAI_API_KEY
# npx wrangler secret put OPENROUTER_API_KEY
```

Set non-secret `RECEIPT_AI_PROVIDER` in the dashboard or `wrangler.jsonc` `vars` when using OpenAI/OpenRouter keys.

Quick OpenRouter check (uses `.dev.vars`; never commit that file):

```bash
node --env-file=.dev.vars scripts/test-openrouter-receipt.mjs
# With a real receipt image:
node --env-file=.dev.vars scripts/test-openrouter-receipt.mjs ./path/to/receipt.jpg
```

`AUTH_SESSION_SECRET` is used both to sign session cookies and to encrypt Google refresh tokens at rest in D1.

Workers AI usage is billed to your Cloudflare account.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auth/me` | `{ user, authConfigured, googleLinked, spreadsheetUrl }` |
| `GET` | `/api/auth/login` | Redirect to Google (sign-in; may obtain refresh token for new users) |
| `GET` | `/api/auth/link-google` | Same account must already be signed in; forces consent to obtain refresh token and bootstrap sheet |
| `GET` | `/api/auth/callback` | OAuth redirect; sets session cookie; may create spreadsheet |
| `POST` | `/api/auth/logout` | Clears session cookie |
| `GET` | `/api/stats` | `{ totalReceipts }` (session) |
| `POST` | `/api/parse` | Parse image (session) |
| `POST` | `/api/submit` | Save + append row to user’s sheet via Sheets API (session) |
| `GET` | `/api/receipt-image/:key` | Image for signed-in owner (session) |

## Repository

This codebase is meant to live in its own GitHub repository named **scan-and-parse**. Create an empty repo on GitHub and push this tree, or use `gh repo create` when your token allows it.
