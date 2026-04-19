# scan-and-parse

Progressive web app for scanning receipts with your phone camera, parsing them with **Cloudflare Workers AI** (Llama 3.2 Vision), reviewing and editing extracted fields, then saving structured data to **D1**, the receipt image to **R2**, and appending rows to a **Google Sheet stored in the user’s Google Drive** (created automatically on first successful OAuth with Drive/Sheets scopes).

## Features

- **Google sign-in** (OAuth 2.0 with PKCE): session cookie; APIs require a signed-in user; data is scoped per Google `sub` in D1 and R2 keys.
- **Google Drive + Sheets (per user)**: OAuth includes `drive.file` and `spreadsheets`. On first sign-in, if Google returns a **refresh token**, the Worker creates a new spreadsheet in the user’s Drive, writes a header row on tab **Receipts**, and stores the spreadsheet id (refresh token is **encrypted** with `AUTH_SESSION_SECRET` in D1). Each approved receipt appends a row via the **Sheets API**.
- **Reconnect Drive/Sheets**: If Google did not return a refresh token on first login (common for returning Google users), use **Connect Google Drive & Sheet** so Google shows **consent** again and issues a refresh token.
- PWA installable on your home screen; camera capture via file input (`capture="environment"`).
- **Parse** uploads the image once; the Worker hashes the bytes (SHA-256) for duplicate detection (per user). Use **JPEG or PNG** at normal camera resolution; **HEIC/HEIF is rejected** (iPhone: Settings → Camera → Formats → **Most Compatible**, or convert before upload). If the vision model returns an empty `{}`-style result, the Worker treats it as a failed step and tries the next provider (or returns a **400** with a clear error if all fail).
- **Duplicate guard**: `409` on submit until “Confirm duplicate” if the same image was already stored for that user.
- **Receipt AI (vision / “OCR”)**: fixed order — **OpenRouter** (if key) → **OpenAI** (if key) → **Google Gemini** (if `GEMINI_API_KEY`, [AI Studio](https://aistudio.google.com/apikey)) → **Cloudflare Workers AI** (Llama 3.2 Vision). Each step is tried on failure or empty output until one succeeds (`worker/receipt-parse-chain.ts`).

## Receipt parsing: OpenRouter → OpenAI → Gemini → Workers AI

| Step | When it runs |
|------|----------------|
| **OpenRouter** | `OPENROUTER_API_KEY` is set; uses `POST …/v1/chat/completions` + `image_url` (`worker/receipt-openai.ts`). |
| **OpenAI** | OpenRouter fails or is skipped (no key); `OPENAI_API_KEY` is set. |
| **Gemini** | Prior steps fail or empty; `GEMINI_API_KEY` set — Google `generateContent` + vision (`worker/receipt-gemini.ts`), `responseMimeType: application/json`. Default **`gemini-2.5-flash`** with automatic fallback to other models if Google returns 404; override with **`GOOGLE_GEMINI_MODEL`**. |
| **Workers AI** | Always last; `@cf/meta/llama-3.2-11b-vision-instruct` (`worker/receipt-ai.ts`). |

**Secrets (optional):** `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, **`GEMINI_API_KEY`** (recommended if Workers AI returns empty JSON on your receipts).  
**Optional vars:** `RECEIPT_VISION_MODEL`, `OPENAI_BASE_URL`, `OPENROUTER_BASE_URL`, **`GOOGLE_GEMINI_MODEL`**.  
`RECEIPT_VISION_MODEL`: bare ids like `gpt-4o-mini` are sent to OpenAI as-is and to OpenRouter as `openai/gpt-4o-mini`. Values with a `/` (e.g. `openai/gpt-4o`, `anthropic/claude-3.5-sonnet`) are used as-is on OpenRouter; on OpenAI fallback, only `openai/…` is mapped to the suffix; other provider prefixes fall back to the default OpenAI model.

**Important:** Putting keys only in **`.env` on your laptop** does **not** give them to the **deployed** Worker. For production/dev on Cloudflare, set **`OPENROUTER_API_KEY`**, **`OPENAI_API_KEY`**, and/or **`GEMINI_API_KEY`** as **Worker secrets** (dashboard **Variables and Secrets**, or `npm run secrets` / `wrangler secret put`). Without external keys, only **Workers AI** runs last (Llama vision can return empty JSON on some receipts).

No `RECEIPT_AI_PROVIDER` or fallback-chain env vars — order is fixed in code.

**JSON output:** The Worker asks vision models for **`response_format: json_object`** where the API supports it (OpenAI-compatible + Workers AI when available), uses stricter prompts with a **minimal valid JSON example**, and repairs common issues (e.g. **trailing commas**) before `JSON.parse`. Markdown-style replies are still parsed as a fallback.

**Tradeoffs:** OpenAI/OpenRouter send the image to a third-party API; Workers AI stays on Cloudflare (Meta “agree” handled in code).

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

## Google OAuth: homepage, privacy, and “verified domain”

Official checklist: [OAuth app verification — homepage requirements](https://support.google.com/cloud/answer/10311615#home&zippy=%2Chomepage-requirements).

### How this repo maps to Google’s checklist

| Google requirement | What to do |
|--------------------|------------|
| Represent brand and describe functionality | **`index.html`** includes a **public** block (before React) describing Scan &amp; Parse: capture, AI parse, edit, save, optional Sheet, duplicates. |
| Explain why you request user data | Same block documents **Sign in with Google**, **Drive (`drive.file`)**, and **Sheets** purposes in plain language. |
| **Verified domain you own** | **You must use a custom domain** (e.g. `https://receipts.yourdomain.com/`) on Cloudflare, verify it in **Google Search Console**. **`*.workers.dev` is usually rejected** (“not registered to you”) because you do not register that subdomain in DNS as your property. |
| Not only third-party social hosts | Do not use Google Sites / Facebook / etc. as the only homepage. **Your Worker + your domain** is fine. |
| **Privacy link on homepage**, same URL as consent screen | **`#site-legal-links`** at the top of every page (never removed) includes **`/privacy`** with **`rel="privacy-policy"`**. **`index.html`** body footer also links **`/privacy`**. Match consent screen **exactly** (e.g. `https://&lt;host&gt;/privacy`). |
| Visible **without login** | Public copy is in static HTML; **footer** always shows **Privacy** and **Terms**. Sign-in is only for the app below. |
| **Responsive** URL | Ensure `GET https://<your-domain>/` returns **200** HTML quickly (no infinite client-only blank state for bots). |
| **No redirect** to a **different domain** than consent screen | Homepage, privacy, and OAuth redirects should all stay on the **same** host you list on the consent screen. |
| **No URL shorteners** | Use full `https://…` links, not `bit.ly` / etc. |

### Canonical URLs (use these on your verified host)

| Page | Path |
|------|------|
| Application home page | `https://<your-domain>/` |
| Privacy policy | `https://<your-domain>/privacy` or `https://<your-domain>/privacy.html` |
| Terms of service | `https://<your-domain>/terms` or `https://<your-domain>/terms.html` |

Both paths return **HTTP 200** with **`Content-Type: text/html; charset=utf-8`** (no redirect to another URL for the policy body). Use the **same** URL string on the OAuth consent screen as in your app links.

### How to: custom domain + Search Console (step by step)

Use a hostname you control, e.g. **`receipts.example.com`** (replace with your real domain).

#### 1) DNS (at your domain registrar or in Cloudflare DNS)

- If the domain **already uses Cloudflare nameservers**, add a **DNS record** for the subdomain:
  - **Type:** `CNAME`
  - **Name:** `receipts` (or `@` for apex — apex to Workers may need [flattening](https://developers.cloudflare.com/dns/proxy-status/#root-domain); a **subdomain** like `receipts` is simplest)
  - **Target:** your Worker’s default host, e.g. **`scan-and-parse-production.pu-cf.workers.dev`** (Cloudflare shows this when you add a custom domain), **or** the target Cloudflare suggests in the UI
  - **Proxy status:** **Proxied** (orange cloud) so HTTPS works on your domain

If the domain is **not** on Cloudflare yet, add the site to Cloudflare and switch nameservers at the registrar first, then add the record.

#### 2) Attach the domain to your Worker (Cloudflare dashboard)

1. **Workers & Pages** → select **`scan-and-parse-production`** (or your Worker) → **Settings** → **Domains & Routes** (or **Triggers** → **Custom Domains** depending on UI).
2. **Add** → **Custom domain** → enter **`receipts.example.com`**.
3. Wait until status is **Active** (DNS + certificate provisioned).
4. In a browser, open **`https://receipts.example.com/`** — you should see the app (same as `workers.dev`).

#### 3) Google Search Console — verify ownership (HTML tag)

1. Go to [Google Search Console](https://search.google.com/search-console).
2. **Add property** → **URL prefix** → enter **`https://receipts.example.com/`** (must match how users open the site, including `https`).
3. Choose verification method **HTML tag**. Google shows a meta tag like:
   ```html
   <meta name="google-site-verification" content="AbCdEfGh..." />
   ```
4. Copy **only** the **`content`** value (the string inside the quotes), e.g. `AbCdEfGh...`.

#### 4) Put that value into the build (so it appears in `index.html`)

This repo injects the tag at **build time** via Vite:

- **Local / `.env`:** add a line (do not commit `.env`):
  ```env
  VITE_GOOGLE_SITE_VERIFICATION=AbCdEfGh...
  ```
  Then run **`npm run build`** and deploy.

- **Cloudflare Workers Builds (Git):** in the Worker → **Settings** → **Build** → **Environment variables** (or “Build variables”), add:
  - **Variable name:** `VITE_GOOGLE_SITE_VERIFICATION`
  - **Value:** the same `content` string  
  Then **Save** and run a new build so `dist/index.html` contains the meta tag.

5. Deploy, then open **`https://receipts.example.com/`** → **View page source** and confirm you see:
   ```html
   <meta name="google-site-verification" content="AbCdEfGh..." />
   ```
6. In Search Console, click **Verify**. If it fails, wait a few minutes for CDN cache, confirm the tag is in the **HTML source** (not only in client-rendered JS), and that you’re verifying the **exact** URL prefix you added.

#### 5) Google Cloud OAuth — use the same hostname everywhere

In **APIs & Services** → **OAuth consent screen** and your **OAuth client**:

| Field | Example value |
|-------|----------------|
| Application home page | `https://receipts.example.com/` |
| Privacy policy link | `https://receipts.example.com/privacy` |
| Terms of service link | `https://receipts.example.com/terms` |
| Authorized JavaScript origins | `https://receipts.example.com` |
| Authorized redirect URIs | `https://receipts.example.com/api/auth/callback` |

Remove or avoid relying on **`*.workers.dev`** URLs for verification if Google requires a domain you verified in Search Console.

#### 6) Optional: branded domain in Cloudflare only

You do **not** have to move DNS away from Cloudflare. You only need a **hostname** on a zone you control, proxied to the Worker, verified in Search Console, and used consistently in OAuth.

## OAuth verification: “How will the scopes be used?” (Sheets)

Paste into **Google Cloud Console → OAuth consent screen** when Google asks how **`https://www.googleapis.com/auth/spreadsheets`** is used (matches this repo’s Worker + `google-api.ts`):

> This scope is used only on the server (Cloudflare Worker) after the user signs in and completes Connect Google Drive & Sheets.
>
> **Create one spreadsheet** for that user the first time they link Google — via `spreadsheets.create` (REST: `POST https://sheets.googleapis.com/v4/spreadsheets`). The file is a normal Google Sheet stored in their Google account.
>
> **Write a single header row** on a tab named **Receipts** so columns are labeled (e.g. id, timestamp, totals, link to receipt image).
>
> **Append one row per receipt** the user has reviewed and approved in the app — via `spreadsheets.values.append`, so each saved receipt appears as a new line in that spreadsheet.
>
> We do not enumerate, list, or bulk-read the user’s other spreadsheets. We do not use this scope to access arbitrary sheets the user never created through our app. The only spreadsheet IDs we call are for the spreadsheet **created for that user by our backend** (we store that id server-side after creation).
>
> The consent screen wording (“all spreadsheets”) is Google’s fixed description for this OAuth scope; our implementation is limited to **creating and updating the user’s dedicated receipt log spreadsheet** as described above.

**`drive.file`** (if asked separately): used server-side only so the app can create and update **files this application creates** in the user’s Drive (the receipt spreadsheet), without full Drive access.

## OAuth verification: YouTube demo video (sensitive / restricted scopes)

Google may require an **unlisted** (or public) YouTube link that shows the **real OAuth grant** and explains **each sensitive/restricted scope** in the context of your app. [Learn more](https://support.google.com/cloud/answer/9110914).

### What to show on screen (legible)

| Moment | What the viewer must see |
|--------|---------------------------|
| Start | **App name** as users see it (e.g. browser tab + in-app title **Scan & Parse**). |
| | Your **production URL** (e.g. `https://scan.talktomydoc.xyz/`). |
| | **Google Cloud Console** → **APIs & Services** → **Credentials** → your **OAuth 2.0 Client ID** (full client id string). Optionally show **Project name** and **Project number**. |
| Sign-in | Click **Continue with Google** → full **Google account chooser** and **OAuth consent** screen with **every scope** listed (openid, email, profile, drive.file, spreadsheets, etc.). |
| | Read aloud or on-screen captions: **why** each scope is needed (identity vs receipt spreadsheet vs Drive file the app creates). |
| Link Google | After signed in, click **Connect Google Drive & Sheet** → second consent if shown → explain **drive.file** + **spreadsheets** again in plain language. |
| In-app proof | Show **Open sheet** (or open Drive/Sheets in another tab) proving a **new spreadsheet** and **Receipts** tab / rows. |
| Optional | Short clip: **Approve & save** a receipt → **new row** appears in the sheet. |

### Script outline (5–10 minutes)

1. **Intro (30s):** “This is Scan & Parse, hosted at [URL]. I’m demonstrating OAuth for Google verification.”
2. **Console (60–90s):** Open Credentials → OAuth client → zoom so **Client ID** is readable; mention **same project** as the consent screen.
3. **First grant (2–3 min):** Incognito or second Google account → **Continue with Google** → walk through consent; pause on each scope and explain.
4. **Drive/Sheets grant (2–3 min):** **Connect Google Drive & Sheet** → consent → explain create/append spreadsheet behavior.
5. **Proof (1–2 min):** Open the created Sheet; show headers and a row.

### Technical tips

- **Resolution:** 1080p, large browser zoom (125–150%) so text is readable when YouTube compresses.
- **Audio:** Clear voiceover or large on-screen text; no copyrighted background music if avoidable.
- **Upload:** YouTube → **Unlisted** → paste URL into the **OAuth verification** form in Google Cloud.

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
- **Google + AI keys** — same `.env`; local **`wrangler dev`** reads them via a generated **`.dev.vars`** (see below). **`ENV_MODE` is not** written to `.dev.vars`. For **hosted** Workers, run **`npm run secrets`** (or set secrets in the dashboard) so **`OPENROUTER_API_KEY`**, **`OPENAI_API_KEY`**, **`GEMINI_API_KEY`** exist on the Worker, not only in `.env`.

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
npm run secrets   # push secrets from .env: Google + session + optional OPENROUTER_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY
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

**Llama 3.2 Vision “5016 / submit prompt agree”:** Cloudflare requires a one-time **`{ "prompt": "agree" }`** call to that model per account (Meta license). The Worker sends this automatically when it detects the gate error, then retries the receipt parse.

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
