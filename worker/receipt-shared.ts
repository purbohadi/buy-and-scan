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

export const RECEIPT_SYSTEM_PROMPT = `You are a receipt OCR assistant. Read the receipt image and return ONLY valid JSON (no markdown) with this shape:
{
  "vendor": string or null,
  "receiptDatetime": string in ISO-8601 if you can infer date/time else null,
  "currency": string ISO currency code like JPY, USD,
  "total": number (tax-included total if visible),
  "category": short English category like food, transport, shopping, lodging, entertainment, other,
  "description": one-line English summary of the purchase,
  "items": [ { "name": string, "quantity": number, "unitPrice": number, "lineTotal": number } ],
  "location": { "label": string or null } or null
}
Use best effort for Japanese receipts: transliterate item names to romaji or English when unclear. If unsure about a field, use null or empty array.`;
