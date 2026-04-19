/**
 * Smoke test OpenRouter vision + JSON extraction (same shape as worker/receipt-openai.ts).
 * Run: node --env-file=.env scripts/test-openrouter-receipt.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const RECEIPT_SYSTEM_PROMPT = `You are a receipt OCR assistant. Read the receipt image and return ONLY valid JSON (no markdown) with this shape:
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
Use best effort for Japanese receipts. If unsure, use null or empty array.`;

function extractJsonObject(text) {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

const provider = (process.env.RECEIPT_AI_PROVIDER ?? "").toLowerCase().trim();
const apiKey = process.env.OPENROUTER_API_KEY ?? "";
const baseUrl = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
const model = process.env.RECEIPT_VISION_MODEL ?? "openai/gpt-4o-mini";

if (provider !== "openrouter") {
  console.error("Set RECEIPT_AI_PROVIDER=openrouter");
  process.exit(1);
}
if (!apiKey) {
  console.error("Set OPENROUTER_API_KEY");
  process.exit(1);
}

let mime = "image/png";
let b64;
const argPath = process.argv[2];
if (argPath) {
  const buf = readFileSync(argPath);
  b64 = buf.toString("base64");
  if (argPath.toLowerCase().endsWith(".jpg") || argPath.toLowerCase().endsWith(".jpeg")) mime = "image/jpeg";
} else {
  // Tiny PNG (1x1) — model may return empty receipt JSON; we still verify API + parser.
  b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  console.log("No image path: using 1x1 PNG. Pass a receipt path for a real parse test.\n");
}

const dataUrl = `data:${mime};base64,${b64}`;
const body = {
  model,
  temperature: 0.2,
  messages: [
    { role: "system", content: RECEIPT_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: "Extract structured receipt data as JSON only." },
        { type: "image_url", image_url: { url: dataUrl } }
      ]
    }
  ]
};

const res = await fetch(`${baseUrl}/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://localhost",
    "X-Title": "Scan & Parse test"
  },
  body: JSON.stringify(body)
});

const rawText = await res.text();
if (!res.ok) {
  console.error("OpenRouter error", res.status, rawText.slice(0, 500));
  process.exit(1);
}

const json = JSON.parse(rawText);
const content = json.choices?.[0]?.message?.content;
const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
console.log("HTTP", res.status, "| model:", model);
console.log("Raw content (first 400 chars):\n", text.slice(0, 400), "\n");

const jsonStr = extractJsonObject(text);
if (!jsonStr) {
  console.error("Could not extract JSON object from model output.");
  process.exit(1);
}
const parsed = JSON.parse(jsonStr);
console.log("Parsed keys:", Object.keys(parsed));
console.log("OK — OpenRouter vision + JSON extraction works.");
process.exit(0);
