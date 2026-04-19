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

Set `RECEIPT_AI_PROVIDER` via `wrangler.jsonc` `vars` or the dashboard for production.

## Production login (`…workers.dev`) fails

Checklist:

1. **Worker secrets** for the **same** environment you deployed (`production` → `wrangler secret put … --env production`, or dashboard **Variables and Secrets** on `scan-and-parse-production`): **`AUTH_SESSION_SECRET`**, **`GOOGLE_CLIENT_ID`**, **`GOOGLE_CLIENT_SECRET`**. If any are missing, Google redirect or token exchange will fail.
2. **Google Cloud Console** → OAuth client → **Authorized redirect URIs** must include exactly:  
   `https://scan-and-parse-production.pu-cf.workers.dev/api/auth/callback`  
   (use your real host if different). **Authorized JavaScript origins**: `https://scan-and-parse-production.pu-cf.workers.dev` (no path, no trailing `/`).
3. After sign-in, the app shows **`Sign-in failed: …`** with a `reason` query param — use that text (or browser devtools → Network → `/api/auth/callback` redirect) to debug.

## Google OAuth: “Access blocked … has not completed verification” (403)

Your app is almost certainly in **Testing** on the **OAuth consent screen**. In that mode, **only** emails listed under **Test users** can sign in.

1. Open [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **OAuth consent screen**.
2. Under **Test users**, click **+ Add users** and add **`purbohadi.utomo@gmail.com`** (and any other Gmail you use on the phone).
3. Save and try **Continue with Google** again.

**Publishing** the app to **In production** allows any Google account, but **sensitive / restricted scopes** (e.g. Drive, Sheets) often require **Google verification** (privacy policy, domain verification, review). For a personal trip app, **Testing + test users** is usually enough.

## Google Cloud setup

1. Create an OAuth **Web application** client.
2. Enable APIs: **Google Drive API** and **Google Sheets API** for the same project.
3. OAuth consent screen: add scopes **…/auth/drive.file** and **…/auth/spreadsheets** (and the default openid/email/profile).
4. **Authorized redirect URIs** (full URL with path):  
   `https://<your-worker-host>/api/auth/callback`  
   and for local Wrangler: `http://127.0.0.1:8787/api/auth/callback`
5. **Authorized JavaScript origins** (origin only, no path, no trailing `/`):  
   `https://<your-worker-host>`, `http://localhost:5173`, `http://127.0.0.1:5173`, etc.

## Environment file (`.env`)

Use a **single** **`.env`** at the repo root (gitignored). Copy **`.env.example`** → **`.env`** and fill in values.

- **`ENV_MODE`** — **`development`** (default) or **`production`**. Controls **`npm run deploy`** and **`npm run secrets`**:
  - `development` → **`wrangler --env development`** → Worker **`scan-and-parse-dev`**.
  - `production` → **`wrangler --env production`** → Worker **`scan-and-parse-production`**.
- **`wrangler.jsonc`** top-level **`name`** is **`scan-and-parse`** (matches Cloudflare project / CI expectations). Named environments override the deployed worker name.
- **`CLOUDFLARE_ACCOUNT_ID`** / **`CLOUDFLARE_API_TOKEN`** — for Wrangler CLI (`whoami`, `deploy`, D1 commands). `account_id` is also in `wrangler.jsonc`; the env var is optional if you rely on that file alone.
- **Google / receipt keys** — same `.env`; Wrangler dev reads them via a generated **`.dev.vars`** (see below). **`ENV_MODE` is not** written to `.dev.vars` (local Worker does not need it).

**Never commit `.env`.**

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
   dotenv -e .env -- wrangler d1 migrations apply scan-and-parse-db --local
   dotenv -e .env -- wrangler d1 migrations apply scan-and-parse-db --remote
   ```

4. Copy `.env.example` → `.env` and set at least `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SESSION_SECRET`, and optionally `CLOUDFLARE_API_TOKEN` for CLI.

5. **`npm run dev`** runs **`predev`**: it syncs **`.env` → `.dev.vars`** for Wrangler, **excluding `CLOUDFLARE_*` and `ENV_MODE`**. **`wrangler dev`** uses **`--env development`** (Worker **`scan-and-parse-dev`**).

   Open http://localhost:5173

## Cloudflare CLI

```bash
dotenv -e .env -- wrangler whoami
```

Deploy and secrets read **`ENV_MODE`** from **`.env`** (via `dotenv -e .env`). Set `ENV_MODE=development` or `ENV_MODE=production` before:

```bash
npm run secrets   # push AUTH_SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET to the target Worker
npm run deploy    # build + deploy to that Worker
```

Rotate `CLOUDFLARE_API_TOKEN` if it was ever exposed.

## Deploy: Cloudflare Connect to Git (Workers Builds)

**Use Cloudflare only** for deploys on push (no duplicate GitHub Actions in this repo).

1. **Workers & Pages** → your Worker → **Settings** → **Builds** (Git integration).
2. **Build command:** e.g. `npm ci && npm run build` (or `npm ci` if deploy runs build).
3. **Deploy command:** must match how you target **development** vs **production** workers:
   - Our `npm run deploy` reads **`ENV_MODE`** from **`.env`**, which is **not** in git. For Workers Builds, either:
     - Set **Build variables** in the dashboard to **`ENV_MODE=production`** (or `development`) for that Worker’s pipeline, **and** use a deploy step that exports them, e.g. `ENV_MODE=production npm run deploy` as the **Deploy command**, or  
     - Run **`wrangler deploy --env production`** / **`wrangler deploy --env development`** explicitly per Worker / branch (see [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)).
4. Keep the **API token** in Build settings current (see **Workers Builds: stale build token** below).

Do **not** add a separate GitHub Actions deploy workflow unless you disable Workers Builds — you would deploy twice per push.

## Git branches vs `ENV_MODE`

| Git branch | Typical `ENV_MODE` in `.env` | Worker |
|------------|------------------------------|--------|
| **`dev`** | `development` (default) | **`scan-and-parse-dev`** |
| **`main`** | `production` | **`scan-and-parse-production`** |

Same **`.env`** file; flip **`ENV_MODE`** when switching deploy target. Both Workers share **D1 + R2** in `wrangler.jsonc` unless you split resources later.

**Google OAuth:** register redirect + JS origins for **both** workers.dev URLs (dev and production).

**PWA / “Continue with Google” does nothing:** the service worker used to intercept `/api/auth/login` and return `index.html`. The build now excludes `/api/*` from the SPA fallback. If an old SW is cached, in Chrome: **Application → Service Workers → Unregister**, then hard-refresh, or reinstall the PWA after redeploy.

Quick OpenRouter smoke test:

```bash
node --env-file=.env scripts/test-openrouter-receipt.mjs
node --env-file=.env scripts/test-openrouter-receipt.mjs ./path/to/receipt.jpg
```

`AUTH_SESSION_SECRET` is used both to sign session cookies and to encrypt Google refresh tokens at rest in D1.

Workers AI usage is billed to your Cloudflare account.

## Workers Builds (Git → Cloudflare): stale build token

If the dashboard shows:

> *The build token selected for this build has been deleted or rolled…*

the **API token** saved under **Workers & Pages** → your Worker → **Settings** → **Builds** → **Build configuration** is invalid (edited, deleted, or rolled). Per [Cloudflare troubleshooting](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/):

1. Open **Build configuration** for the Worker.
2. Under **API token**, choose **Create new token** or pick a **fresh** token you control (Workers Scripts Edit + related permissions for D1/R2 as needed).
3. Save and **retry the build**.

This is configured only in the Cloudflare dashboard, not in `wrangler.jsonc`.

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
