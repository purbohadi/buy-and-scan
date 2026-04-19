import type { ParsedReceipt } from "./types";

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** First top-level `{ ... }` with brace depth (handles `}` inside JSON strings). */
function extractFirstBalancedJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

export function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  const balanced = extractFirstBalancedJsonObject(candidate);
  if (balanced) return balanced;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export function normalizeParsed(raw: Record<string, unknown>): ParsedReceipt {
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const items = itemsRaw.map((it) => {
    const o = it as Record<string, unknown>;
    const quantity = Number(o.quantity ?? 1) || 1;
    const unitPrice = Number(o.unitPrice ?? o.price ?? 0) || 0;
    const lineTotal =
      o.lineTotal !== undefined
        ? Number(o.lineTotal) || 0
        : Math.round(quantity * unitPrice * 100) / 100;
    return {
      name: String(o.name ?? o.label ?? "Item"),
      quantity,
      unitPrice,
      lineTotal
    };
  });

  const loc = raw.location as Record<string, unknown> | undefined;
  const location =
    loc && (loc.latitude != null || loc.longitude != null || loc.label)
      ? {
          latitude: loc.latitude != null ? Number(loc.latitude) : undefined,
          longitude: loc.longitude != null ? Number(loc.longitude) : undefined,
          label: loc.label != null ? String(loc.label) : undefined
        }
      : undefined;

  const currency = String(raw.currency ?? "JPY").toUpperCase().slice(0, 8);
  const total = Number(raw.total ?? 0) || 0;

  return {
    vendor: raw.vendor != null ? String(raw.vendor) : undefined,
    receiptDatetime: raw.receiptDatetime != null ? String(raw.receiptDatetime) : undefined,
    currency,
    total,
    category: raw.category != null ? String(raw.category) : undefined,
    description: raw.description != null ? String(raw.description) : undefined,
    items,
    location
  };
}

export const RECEIPT_SYSTEM_PROMPT = `You are a receipt OCR assistant. Read the receipt image.

CRITICAL OUTPUT RULES:
- Reply with ONE JSON object only. No markdown, no **bold**, no headings, no bullet lists, no prose before or after the JSON.
- The first character of your reply must be "{" and the last must be "}".

JSON shape:
{
  "vendor": string or null,
  "receiptDatetime": string in ISO-8601 if you can infer date/time else null,
  "currency": string ISO currency code like JPY, USD, IDR,
  "total": number (tax-included total if visible),
  "category": short English category like food, transport, shopping, lodging, entertainment, other,
  "description": one-line English summary of the purchase,
  "items": [ { "name": string, "quantity": number, "unitPrice": number, "lineTotal": number } ],
  "location": { "label": string or null } or null
}
Use best effort for Japanese and Indonesian receipts. If unsure about a field, use null or empty array.`;

/** Parse IDR-style amounts: Rp124,290 / Rp124.290 / 138.100 → integer minor-ish units as number. */
export function parseMoneyToNumber(raw: string): number | null {
  const s = raw.replace(/Rp/gi, "").replace(/\s/g, "").trim();
  if (!s) return null;
  const cleaned = s.replace(/[^\d.,]/g, "");
  if (!cleaned) return null;
  // Thousands grouped: 124.290 or 124,290 (both separators as thousands)
  if (/^\d{1,3}([.,]\d{3})+$/.test(cleaned)) {
    return Math.round(Number(cleaned.replace(/[.,]/g, ""))) || null;
  }
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decSep = Math.max(lastComma, lastDot);
  if (decSep === -1) return Math.round(Number(cleaned)) || null;
  const intPart = cleaned.slice(0, decSep).replace(/[.,]/g, "");
  const fracPart = cleaned.slice(decSep + 1).replace(/\D/g, "");
  const n = Number(`${intPart}.${fracPart || "0"}`);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function mdField(text: string, label: string): string | null {
  const re = new RegExp(`\\*\\*\\s*${label}\\s*:\\s*\\*\\*\\s*([^\\n]+)`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Best-effort when the vision model returns markdown instead of JSON (Workers AI sometimes does this).
 */
export function parseReceiptFromMarkdownStyle(text: string): ParsedReceipt | null {
  const t = text.trim();
  if (!t.includes("**") && !t.includes("Vendor")) return null;

  const vendor = mdField(t, "Vendor");
  const dateRaw = mdField(t, "Receipt Date") ?? mdField(t, "Date") ?? mdField(t, "receiptDatetime");
  const currencyRaw = mdField(t, "Currency");
  const totalRaw = mdField(t, "Total");
  const category = mdField(t, "Category");
  const description = mdField(t, "Description");

  let total = 0;
  if (totalRaw) {
    const money = totalRaw.match(/Rp?\s*([\d.,]+)/i);
    if (money) {
      const n = parseMoneyToNumber(money[0]);
      if (n != null) total = n;
    }
  }

  let currency = "IDR";
  if (currencyRaw) {
    const iso = currencyRaw.match(/\b([A-Z]{3})\b/i);
    if (iso) currency = iso[1].toUpperCase();
    else if (/rupiah|idr/i.test(currencyRaw)) currency = "IDR";
  }

  const items: ParsedReceipt["items"] = [];
  const itemsBlock = t.split(/\*\*Items:\*\*/i)[1];
  if (itemsBlock) {
    const bulletNames = [
      ...itemsBlock.matchAll(/(?:^|\n)\s*[-*]\s*\*\*([^*]+)\*\*/gim),
      ...itemsBlock.matchAll(/(?:^|\n)\s*\*\s+\*\*([^*]+)\*\*/gim)
    ].map((m) => m[1].trim());
    const seen = new Set<string>();
    for (const name of bulletNames) {
      if (!name || /^items$/i.test(name) || seen.has(name)) continue;
      seen.add(name);
      items.push({ name, quantity: 1, unitPrice: 0, lineTotal: 0 });
    }
  }

  const locLabel = mdField(t, "Address") ?? mdField(t, "Location");

  if (!vendor && total === 0 && items.length === 0) return null;

  return normalizeParsed({
    vendor: vendor ?? null,
    receiptDatetime: dateRaw ?? null,
    currency,
    total,
    category: category ?? null,
    description: description ?? null,
    items,
    location: locLabel ? { label: locLabel } : null
  });
}

/** Prefer strict JSON; fall back to markdown-style vision output. */
export function parseReceiptModelText(text: string): ParsedReceipt {
  const jsonStr = extractJsonObject(text);
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      return normalizeParsed(parsed);
    } catch {
      /* fall through */
    }
  }
  const md = parseReceiptFromMarkdownStyle(text);
  if (md) return md;
  const preview = text.replace(/\s+/g, " ").trim().slice(0, 280);
  throw new Error(`Model did not return parseable JSON (preview: ${preview || "(empty)"})`);
}
