# scan-and-parse

Progressive web app for scanning receipts with your phone camera, parsing them with **Cloudflare Workers AI** (Llama 3.2 Vision), reviewing and editing extracted fields, then saving structured data to **D1**, the receipt image to **R2**, and appending a row to **Google Sheets** (via a small **Apps Script** webhook).

## Features

- PWA installable on your home screen; camera capture via file input (`capture="environment"`).
- **Parse** uploads the image once; the Worker hashes the bytes (SHA-256) for duplicate detection.
- **Review** vendor, ISO datetime, currency, total, category, summary, optional GPS, and line items.
- **Approve** stores the row in D1 and the image in R2; responds with a public image URL served by the Worker.
- **Duplicate guard**: if the same image was stored before, the API returns `409` until you tick “Confirm duplicate”.
- **Counter**: the UI shows how many receipts are already stored (`GET /api/stats`).

## Local development

1. `npm install`
2. Create Cloudflare resources (once per account):

   ```bash
   npx wrangler d1 create scan-and-parse-db
   npx wrangler r2 bucket create scan-and-parse-receipts
   ```

   Copy the D1 `database_id` into `wrangler.jsonc` (replace `REPLACE_WITH_D1_ID_AFTER_CREATION`).

3. Apply the schema:

   ```bash
   npx wrangler d1 migrations apply scan-and-parse-db --local
   npx wrangler d1 migrations apply scan-and-parse-db --remote
   ```

4. Optional: Google Sheets — create a spreadsheet, add the script from `scripts/google-apps-script.js` (set `SHEET_ID`, deploy as Web App), then put the web app URL in `.dev.vars`:

   ```
   GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
   GOOGLE_APPS_SCRIPT_SECRET=choose-a-long-random-string
   ```

   The same secret must appear as `WEBHOOK_SECRET` in the Apps Script file.

5. Run the API and the Vite dev server (Vite proxies `/api` to Wrangler on port 8787):

   ```bash
   npm run dev
   ```

   Open http://localhost:5173

## Deploy

```bash
npm run deploy
```

Set production secrets in the dashboard or with Wrangler:

```bash
npx wrangler secret put GOOGLE_APPS_SCRIPT_URL
npx wrangler secret put GOOGLE_APPS_SCRIPT_SECRET
```

Workers AI usage is billed to your Cloudflare account; vision models can be slower on large photos.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/stats` | `{ totalReceipts }` |
| `POST` | `/api/parse` | `multipart/form-data` field `image` **or** JSON `{ imageBase64, imageMime }` → parsed draft + `contentHash` + duplicate info |
| `POST` | `/api/submit` | JSON `{ contentHash, imageBase64, imageMime?, receipt, confirmDuplicate? }` |
| `GET` | `/api/receipt-image/:key` | Public image bytes from R2 |

## Repository

This codebase is meant to live in its own GitHub repository named **scan-and-parse**.

### Create the repo on GitHub (manual)

Some automation environments cannot call `gh repo create` for you. In that case:

1. On GitHub, create a new empty repository `scan-and-parse` (no README) under your user or org.
2. From this project directory:

   ```bash
   git remote add scan-and-parse https://github.com/<you>/scan-and-parse.git
   git push -u scan-and-parse cursor/scan-and-parse-spa-e528:main
   ```

   Replace `<you>` with your GitHub username or org, and adjust the branch name if you merged locally first.

### GitHub CLI (when your token allows it)

```bash
gh repo create scan-and-parse --public --source=. --remote=scan-and-parse --push
```
