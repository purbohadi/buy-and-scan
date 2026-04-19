import { coerceMoneyScalar, parseMoneyString, sanitizeMoneyAmount, sanitizeReceiptMoney } from "../shared/money";
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

/** RFC 8259-ish fixes before JSON.parse (trailing commas, BOM). */
export function repairJsonText(s: string): string {
  let t = s.replace(/^\uFEFF/, "").trim();
  t = t.replace(/,\s*([}\]])/g, "$1");
  return t;
}

export function tryParseReceiptJsonObject(jsonStr: string): Record<string, unknown> | null {
  const repaired = repairJsonText(jsonStr);
  try {
    return JSON.parse(repaired) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function normalizeParsed(raw: Record<string, unknown>): ParsedReceipt {
  const currency = String(raw.currency ?? "JPY").toUpperCase().slice(0, 8);
  const itemsRaw = Array.isArray(raw.items) ? raw.items : [];
  const items = itemsRaw.map((it) => {
    const o = it as Record<string, unknown>;
    const name = String(o.name ?? o.label ?? "Item");
    const quantity = Math.max(1, Math.round(coerceMoneyScalar(o.quantity ?? 1)) || 1);
    let unitPrice = sanitizeMoneyAmount(coerceMoneyScalar(o.unitPrice ?? o.price ?? 0), currency);
    let lineTotal = sanitizeMoneyAmount(coerceMoneyScalar(o.lineTotal ?? 0), currency);
    if (lineTotal === 0 && unitPrice > 0) {
      lineTotal = sanitizeMoneyAmount(unitPrice * quantity, currency);
    }
    if (unitPrice === 0 && lineTotal > 0 && quantity > 0) {
      unitPrice = sanitizeMoneyAmount(lineTotal / quantity, currency);
    }
    return { name, quantity, unitPrice, lineTotal };
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

  let total = sanitizeMoneyAmount(coerceMoneyScalar(raw.total ?? 0), currency);
  const sumLines = items.reduce((s, it) => s + it.lineTotal, 0);
  if (total === 0 && sumLines > 0) total = sanitizeMoneyAmount(sumLines, currency);

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

export const RECEIPT_JSON_EXAMPLE = `{"vendor":"ACME Store","receiptDatetime":"2025-10-04T11:26:00+07:00","currency":"IDR","total":124290,"category":"shopping","description":"Office supplies","items":[{"name":"Pen","quantity":1,"unitPrice":5000,"lineTotal":5000}],"location":{"label":"Jl. Example No.1"}}`;

export const RECEIPT_SYSTEM_PROMPT = `You are a receipt OCR assistant. Read the receipt image.

OUTPUT MUST BE VALID RFC 8259 JSON ONLY:
- Output exactly one JSON object. No markdown, no code fences, no **bold**, no bullet lists, no text before { or after }.
- Use double quotes for all keys and string values. No trailing commas. Use null for unknown strings; use [] for empty items.
- Numbers must be JSON numbers (no thousands separators, no currency symbols inside numbers). Example total: 124290 not "124,290".
- "currency" must be a 3-letter ISO code (e.g. IDR, JPY, USD).
- "items" is an array of objects, each with "name" (string), "quantity" (integer), "unitPrice" (number), "lineTotal" (number).

Valid minimal shape (example only — replace with real values from the image):
${RECEIPT_JSON_EXAMPLE}

Use best effort for Japanese and Indonesian receipts.`;

export const RECEIPT_USER_JSON_ONLY = `Return ONLY the JSON object for this receipt image. Start with { and end with }. Every string in JSON must use double quotes. No trailing commas.`;

/** @deprecated use parseMoneyString from shared/money */
export const parseMoneyToNumber = parseMoneyString;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Workers AI often emits `**Vendor:** Toko …` (value NOT wrapped in `**`).
 * Some models use `**Vendor:** **Toko …**` — support both.
 */
function mdField(text: string, label: string): string | null {
  const esc = escapeRegExp(label);
  const wrapped = new RegExp(
    `\\*\\*\\s*${esc}\\s*:\\s*\\*\\*\\s*\\*\\*([^*]+)\\*\\*`,
    "i"
  );
  const w = text.match(wrapped);
  if (w) return w[1].trim();
  const plain = new RegExp(`\\*\\*\\s*${esc}\\s*:\\s*\\*\\*\\s*(.+?)(?=\\s*\\*\\*|$)`, "is");
  const p = text.match(plain);
  return p ? p[1].trim() : null;
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
      const n = parseMoneyString(money[0]);
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

  return sanitizeReceiptMoney(
    normalizeParsed({
      vendor: vendor ?? null,
      receiptDatetime: dateRaw ?? null,
      currency,
      total,
      category: category ?? null,
      description: description ?? null,
      items,
      location: locLabel ? { label: locLabel } : null
    })
  );
}

/** Prefer strict JSON; fall back to markdown-style vision output. */
export function parseReceiptModelText(text: string): ParsedReceipt {
  const jsonStr = extractJsonObject(text);
  if (jsonStr) {
    const parsed = tryParseReceiptJsonObject(jsonStr);
    if (parsed) return sanitizeReceiptMoney(normalizeParsed(parsed));
  }
  const md = parseReceiptFromMarkdownStyle(text);
  if (md) return sanitizeReceiptMoney(md);
  const preview = text.replace(/\s+/g, " ").trim().slice(0, 280);
  throw new Error(`Model did not return parseable JSON (preview: ${preview || "(empty)"})`);
}
