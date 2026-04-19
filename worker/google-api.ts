import { isZeroDecimalCurrency } from "../shared/money";
import type { ParsedReceipt } from "./types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type TokenBundle = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
};

export async function exchangeAuthCode(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenBundle> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as TokenBundle;
  if (!json.access_token) throw new Error("No access_token in token response");
  return json;
}

export async function refreshAccessToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokenBundle> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: params.clientId,
    client_secret: params.clientSecret,
    refresh_token: params.refreshToken
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Refresh failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as TokenBundle;
  if (!json.access_token) throw new Error("No access_token on refresh");
  return json;
}

function sheetMoneyString(n: number, currency: string): string {
  const c = String(currency ?? "").toUpperCase().slice(0, 8);
  if (isZeroDecimalCurrency(c)) return String(Math.round(n));
  const v = Math.round(n * 100) / 100;
  return String(v);
}

function itemsDetailBullets(receipt: ParsedReceipt): string {
  const c = receipt.currency;
  const lines = receipt.items.map(
    (it) =>
      `• ${it.name} ×${it.quantity} @ ${sheetMoneyString(it.unitPrice, c)} = ${sheetMoneyString(it.lineTotal, c)}`
  );
  return lines.join("\n");
}

/** Sheet-friendly date/time (no raw ISO T/Z in cell). */
function formatSheetDateTime(iso: string): string {
  const s = iso.trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function sheetDateTimeCell(receipt: ParsedReceipt, createdAtIso: string): string {
  const raw = receipt.receiptDatetime?.trim() || createdAtIso;
  return formatSheetDateTime(raw);
}

/** Prefer AI description; fall back so the column is rarely blank. */
function sheetSummaryCell(receipt: ParsedReceipt): string {
  const d = receipt.description?.trim();
  if (d) return d;
  const parts = [receipt.vendor?.trim(), receipt.category?.trim()].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  if (receipt.items.length) {
    const names = receipt.items
      .map((it) => it.name?.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (names.length) return `Receipt: ${names.join(", ")}${receipt.items.length > 3 ? "…" : ""}`;
  }
  return "";
}

function locationCell(receipt: ParsedReceipt): string {
  const loc = receipt.location;
  if (!loc) return "";
  if (loc.label) return loc.label;
  if (loc.latitude != null && loc.longitude != null) {
    return `${loc.latitude},${loc.longitude}`;
  }
  return "";
}

const RECEIPT_SHEET_TITLE = "Receipts";
const HEADER_ROW = [
  "number",
  "id",
  "Date Time",
  "location",
  "AI Summary",
  "category",
  "items detail",
  "total price",
  "currency",
  "image receipt url"
];

export async function ensureReceiptSpreadsheet(accessToken: string): Promise<{ id: string; url: string }> {
  const createRes = await fetch("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      properties: { title: `Scan & Parse — receipts ${new Date().toISOString().slice(0, 10)}` },
      sheets: [{ properties: { title: RECEIPT_SHEET_TITLE } }]
    })
  });
  if (!createRes.ok) {
    const t = await createRes.text();
    throw new Error(`Create spreadsheet failed: ${createRes.status} ${t.slice(0, 200)}`);
  }
  const created = (await createRes.json()) as {
    spreadsheetId: string;
    spreadsheetUrl?: string;
    properties?: { title?: string };
  };
  const id = created.spreadsheetId;
  const url = created.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${id}/edit`;

  const range = encodeURIComponent(`${RECEIPT_SHEET_TITLE}!A1:J1`);
  const valuesRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${range}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ values: [HEADER_ROW] })
    }
  );
  if (!valuesRes.ok) {
    const t = await valuesRes.text();
    throw new Error(`Write header failed: ${valuesRes.status} ${t.slice(0, 200)}`);
  }

  return { id, url };
}

export async function appendReceiptRow(params: {
  accessToken: string;
  spreadsheetId: string;
  rowNumber: number;
  receiptId: string;
  createdAtIso: string;
  receipt: ParsedReceipt;
  imagePublicUrl: string;
}): Promise<void> {
  const c = params.receipt.currency;
  const row = [
    String(params.rowNumber),
    params.receiptId,
    sheetDateTimeCell(params.receipt, params.createdAtIso),
    locationCell(params.receipt),
    sheetSummaryCell(params.receipt),
    params.receipt.category ?? "",
    itemsDetailBullets(params.receipt),
    sheetMoneyString(params.receipt.total, c),
    params.receipt.currency,
    params.imagePublicUrl
  ];
  const encRange = encodeURIComponent(`${RECEIPT_SHEET_TITLE}!A:J`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${params.spreadsheetId}/values/${encRange}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values: [row] })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Append row failed: ${res.status} ${t.slice(0, 200)}`);
  }
}
