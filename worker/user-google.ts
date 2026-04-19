import { appendReceiptRow, ensureReceiptSpreadsheet, refreshAccessToken } from "./google-api";
import type { ParsedReceipt } from "./types";
import { decryptToken, encryptToken } from "./token-crypto";

type EnvSlice = {
  DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  AUTH_SESSION_SECRET?: string;
};

export type GoogleAccountRow = {
  refresh_token_enc: string | null;
  spreadsheet_id: string | null;
  spreadsheet_url: string | null;
};

export async function loadGoogleAccount(db: D1Database, userId: string): Promise<GoogleAccountRow | null> {
  return db
    .prepare(
      "SELECT refresh_token_enc, spreadsheet_id, spreadsheet_url FROM google_accounts WHERE user_id = ? LIMIT 1"
    )
    .bind(userId)
    .first<GoogleAccountRow>();
}

export async function getAccessTokenForUser(env: EnvSlice, userId: string): Promise<string | null> {
  const secret = env.AUTH_SESSION_SECRET;
  const cid = env.GOOGLE_CLIENT_ID;
  const cs = env.GOOGLE_CLIENT_SECRET;
  if (!secret || !cid || !cs) return null;
  const acc = await loadGoogleAccount(env.DB, userId);
  if (!acc?.refresh_token_enc) return null;
  const rt = await decryptToken(secret, acc.refresh_token_enc);
  if (!rt) return null;
  try {
    const bundle = await refreshAccessToken({ clientId: cid, clientSecret: cs, refreshToken: rt });
    return bundle.access_token;
  } catch {
    return null;
  }
}

export async function persistGoogleAccount(params: {
  env: EnvSlice;
  userId: string;
  refreshTokenPlain: string | null;
  keepExistingRefreshIfNull: boolean;
  accessTokenForBootstrap: string;
}): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const secret = params.env.AUTH_SESSION_SECRET;
  if (!secret) throw new Error("AUTH_SESSION_SECRET missing");

  const existing = await loadGoogleAccount(params.env.DB, params.userId);
  let refreshEnc: string | null = null;
  if (params.refreshTokenPlain) {
    refreshEnc = await encryptToken(secret, params.refreshTokenPlain);
  } else if (params.keepExistingRefreshIfNull && existing?.refresh_token_enc) {
    refreshEnc = existing.refresh_token_enc;
  } else {
    throw new Error("No refresh token from Google; use reconnect with consent.");
  }

  let spreadsheetId = existing?.spreadsheet_id ?? null;
  let spreadsheetUrl = existing?.spreadsheet_url ?? null;
  if (!spreadsheetId) {
    const s = await ensureReceiptSpreadsheet(params.accessTokenForBootstrap);
    spreadsheetId = s.id;
    spreadsheetUrl = s.url;
  }

  const sid = spreadsheetId as string;
  const surl = spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${sid}/edit`;

  const now = new Date().toISOString();
  await params.env.DB
    .prepare(
      `INSERT INTO google_accounts (user_id, refresh_token_enc, spreadsheet_id, spreadsheet_url, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         refresh_token_enc = excluded.refresh_token_enc,
         spreadsheet_id = excluded.spreadsheet_id,
         spreadsheet_url = excluded.spreadsheet_url,
         updated_at = excluded.updated_at`
    )
    .bind(params.userId, refreshEnc, sid, surl, now)
    .run();

  return { spreadsheetId: sid, spreadsheetUrl: surl };
}

export async function appendUserReceiptToGoogleSheet(params: {
  env: EnvSlice;
  userId: string;
  rowNumber: number;
  receiptId: string;
  createdAtIso: string;
  receipt: ParsedReceipt;
  imagePublicUrl: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const acc = await loadGoogleAccount(params.env.DB, params.userId);
    if (!acc?.refresh_token_enc || !acc.spreadsheet_id) {
      return { ok: false, error: "Google Drive/Sheets not linked; sign in again with consent." };
    }
    const access = await getAccessTokenForUser(params.env, params.userId);
    if (!access) {
      return { ok: false, error: "Could not refresh Google access; reconnect your Google account." };
    }
    await appendReceiptRow({
      accessToken: access,
      spreadsheetId: acc.spreadsheet_id,
      rowNumber: params.rowNumber,
      receiptId: params.receiptId,
      createdAtIso: params.createdAtIso,
      receipt: params.receipt,
      imagePublicUrl: params.imagePublicUrl
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sheets append failed";
    return { ok: false, error: msg };
  }
}
