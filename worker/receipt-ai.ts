import type { ParsedReceipt } from "./types";

const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function normalizeParsed(raw: Record<string, unknown>): ParsedReceipt {
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

const SYSTEM_PROMPT = `You are a receipt OCR assistant. Read the receipt image and return ONLY valid JSON (no markdown) with this shape:
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

export async function parseReceiptWithAi(
  ai: Ai,
  imageBytes: Uint8Array,
  mime: string
): Promise<ParsedReceipt> {
  const dataUrl = `data:${mime};base64,${bytesToBase64(imageBytes)}`;

  const res = (await ai.run(VISION_MODEL, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "Extract structured receipt data as JSON only. If multiple languages, prefer amounts from printed totals."
      }
    ],
    image: dataUrl
  })) as { response?: string };

  const text = typeof res === "string" ? res : res.response ?? JSON.stringify(res);
  const jsonStr = extractJsonObject(text);
  if (!jsonStr) {
    throw new Error("Model did not return parseable JSON");
  }
  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  return normalizeParsed(parsed);
}
