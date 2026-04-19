/**
 * Smoke test OpenRouter vision + JSON (same flow as worker/receipt-openai.ts for openrouter).
 * Default model: google/gemini-2.5-flash
 *
 * Run:
 *   node --env-file=.env scripts/test-openrouter-receipt.mjs
 *   node --env-file=.env scripts/test-openrouter-receipt.mjs ./path/to/receipt.jpg
 *   node --env-file=.env scripts/test-openrouter-receipt.mjs ./receipt.jpg anthropic/claude-3.5-sonnet
 */
import { readFileSync } from "node:fs";

const RECEIPT_JSON_EXAMPLE = `{"vendor":"ACME Store","receiptDatetime":"2025-10-04T11:26:00+07:00","currency":"IDR","total":124290,"category":"shopping","description":"Office supplies","items":[{"name":"Pen","quantity":1,"unitPrice":5000,"lineTotal":5000}],"location":{"label":"Jl. Example No.1"}}`;

const RECEIPT_SYSTEM_PROMPT = `You are a receipt OCR assistant. Read the receipt image.

OUTPUT MUST BE VALID RFC 8259 JSON ONLY:
- Output exactly one JSON object. No markdown, no code fences, no **bold**, no bullet lists, no text before { or after }.
- Use double quotes for all keys and string values. No trailing commas. Use null for unknown strings; use [] for empty items.
- Numbers must be JSON numbers (no thousands separators, no currency symbols inside numbers). Example total: 124290 not "124,290".
- "currency" must be a 3-letter ISO code (e.g. IDR, JPY, USD).
- "items" is an array of objects, each with "name" (string), "quantity" (integer), "unitPrice" (number), "lineTotal" (number).
- Discount lines: use negative numbers for "unitPrice" and/or "lineTotal" (e.g. -13810). Name may be "Diskon Transaksi" or "Discount".

Valid minimal shape (example only — replace with real values from the image):
${RECEIPT_JSON_EXAMPLE}

Use best effort for Japanese and Indonesian receipts.`;

const RECEIPT_USER_JSON_ONLY = `Return ONLY the JSON object for this receipt image. Start with { and end with }. Every string in JSON must use double quotes. No trailing commas.`;

function extractFirstBalancedJsonObject(s) {
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

function repairJsonText(s) {
  let t = s.replace(/^\uFEFF/, "").trim();
  return t.replace(/,\s*([}\]])/g, "$1");
}

function extractJsonObject(text) {
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

const DEFAULT_OPENROUTER_MODEL = "google/gemini-2.5-flash";

const apiKey = process.env.OPENROUTER_API_KEY ?? "";
const baseUrl = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
const argPath = process.argv[2];
const argModel = process.argv[3];
const model =
  argModel?.trim() ||
  process.env.RECEIPT_VISION_MODEL?.trim() ||
  process.env.OPENROUTER_TEST_MODEL?.trim() ||
  DEFAULT_OPENROUTER_MODEL;

if (!apiKey) {
  console.error("Set OPENROUTER_API_KEY in .env");
  process.exit(1);
}

let mime = "image/png";
let b64;
if (argPath && !argPath.includes("=") && (argPath.includes("/") || argPath.includes("\\") || argPath.endsWith(".jpg") || argPath.endsWith(".jpeg") || argPath.endsWith(".png") || argPath.endsWith(".webp"))) {
  const buf = readFileSync(argPath);
  b64 = buf.toString("base64");
  const low = argPath.toLowerCase();
  if (low.endsWith(".jpg") || low.endsWith(".jpeg")) mime = "image/jpeg";
  else if (low.endsWith(".webp")) mime = "image/webp";
} else {
  b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  console.log("No receipt image path: using 1x1 PNG. Pass a path as first arg for a real receipt test.\n");
}

const dataUrl = `data:${mime};base64,${b64}`;
const messages = [
  { role: "system", content: RECEIPT_SYSTEM_PROMPT },
  {
    role: "user",
    content: [
      { type: "text", text: RECEIPT_USER_JSON_ONLY },
      { type: "image_url", image_url: { url: dataUrl } }
    ]
  }
];

async function post(withJsonMode) {
  return fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://scan-and-parse.local",
      "X-Title": "Scan & Parse OpenRouter test"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
      messages
    })
  });
}

let res = await post(true);
if (!res.ok) {
  const t = await res.text();
  if (/response_format|json_object|unsupported|invalid_request/i.test(t)) {
    res = await post(false);
    if (!res.ok) {
      console.error("OpenRouter error (retry without json_object)", res.status, (await res.text()).slice(0, 600));
      process.exit(1);
    }
  } else {
    console.error("OpenRouter error", res.status, t.slice(0, 600));
    process.exit(1);
  }
}

const rawText = await res.text();
const json = JSON.parse(rawText);
const content = json.choices?.[0]?.message?.content;
const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
console.log("HTTP", res.status, "| model:", model);
console.log("Raw content (first 500 chars):\n", text.slice(0, 500), "\n");

const jsonStr = extractJsonObject(text);
if (!jsonStr) {
  console.error("Could not extract JSON object from model output.");
  process.exit(1);
}
let parsed;
try {
  parsed = JSON.parse(repairJsonText(jsonStr));
} catch (e) {
  console.error("JSON.parse failed:", e.message);
  process.exit(1);
}
console.log("Parsed keys:", Object.keys(parsed));
console.log("OK — OpenRouter vision + JSON works with", model);
process.exit(0);
