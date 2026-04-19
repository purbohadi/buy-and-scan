import { appendReceiptRowsBatch, ensureReceiptSpreadsheet, receiptToSheetRow } from "./google-api";
import { getAccessTokenForUser, loadGoogleAccount } from "./user-google";
import type { ParsedReceipt } from "./types";

type EnvSlice = {
  DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  AUTH_SESSION_SECRET?: string;
};

function publicImageUrlFromRequest(request: Request, key: string): string {
  const u = new URL(request.url);
  return `${u.origin}/api/receipt-image/${encodeURIComponent(key)}`;
}

export async function updateGoogleSpreadsheetMeta(
  db: D1Database,
  userId: string,
  spreadsheetId: string,
  spreadsheetUrl: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE google_accounts SET spreadsheet_id = ?, spreadsheet_url = ?, updated_at = ? WHERE user_id = ?`
    )
    .bind(spreadsheetId, spreadsheetUrl, now, userId)
    .run();
}

/**
 * Create a new spreadsheet, update google_accounts, and fill Receipts tab from D1 (oldest first → row numbers match order).
 */
export async function rebuildUserGoogleSheetFromD1(
  env: EnvSlice,
  userId: string,
  request: Request
): Promise<{ spreadsheetId: string; spreadsheetUrl: string; rowsWritten: number }> {
  const acc = await loadGoogleAccount(env.DB, userId);
  if (!acc?.refresh_token_enc) {
    throw new Error("Google Drive/Sheets not linked; connect Google first.");
  }
  const access = await getAccessTokenForUser(env, userId);
  if (!access) throw new Error("Could not refresh Google access; reconnect your Google account.");

  const { id: spreadsheetId, url: spreadsheetUrl } = await ensureReceiptSpreadsheet(access);
  await updateGoogleSpreadsheetMeta(env.DB, userId, spreadsheetId, spreadsheetUrl);

  const { results } = await env.DB
    .prepare(
      `SELECT id, created_at, receipt_datetime, vendor, category, description, currency, total, items_json, location_json, image_r2_key
       FROM receipts WHERE user_id = ?
       ORDER BY datetime(created_at) ASC`
    )
    .bind(userId)
    .all<{
      id: string;
      created_at: string;
      receipt_datetime: string | null;
      vendor: string | null;
      category: string | null;
      description: string | null;
      currency: string;
      total: number;
      items_json: string;
      location_json: string | null;
      image_r2_key: string;
    }>();

  const rows: string[][] = [];
  let n = 0;
  for (const r of results ?? []) {
    n++;
    let items: ParsedReceipt["items"] = [];
    let location: ParsedReceipt["location"] | undefined;
    try {
      items = JSON.parse(r.items_json) as ParsedReceipt["items"];
    } catch {
      items = [];
    }
    if (r.location_json) {
      try {
        location = JSON.parse(r.location_json) as ParsedReceipt["location"];
      } catch {
        location = undefined;
      }
    }
    const receipt: ParsedReceipt = {
      vendor: r.vendor ?? undefined,
      receiptDatetime: r.receipt_datetime ?? undefined,
      currency: r.currency || "JPY",
      total: r.total,
      category: r.category ?? undefined,
      description: r.description ?? undefined,
      items: Array.isArray(items) ? items : [],
      location
    };
    const imageUrl = publicImageUrlFromRequest(request, r.image_r2_key);
    rows.push(
      receiptToSheetRow({
        rowNumber: n,
        receiptId: r.id,
        createdAtIso: r.created_at,
        receipt,
        imagePublicUrl: imageUrl
      })
    );
  }

  await appendReceiptRowsBatch(access, spreadsheetId, rows);
  return { spreadsheetId, spreadsheetUrl, rowsWritten: rows.length };
}
