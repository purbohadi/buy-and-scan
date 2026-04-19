import { bytesToBase64, parseReceiptModelText, RECEIPT_SYSTEM_PROMPT, RECEIPT_USER_JSON_ONLY } from "./receipt-shared";
import type { ParsedReceipt } from "./types";

/** Google retires old model ids for new API keys — prefer current Flash. */
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash", "gemini-1.5-pro"];
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiEnv = {
  GEMINI_API_KEY?: string;
  /** e.g. gemini-2.5-flash — from Google AI Studio */
  GOOGLE_GEMINI_MODEL?: string;
};

function isGeminiModelNotFound(status: number, body: string): boolean {
  if (status === 404) return true;
  return /NOT_FOUND|no longer available|is not found|Invalid model/i.test(body);
}

function uniqueModels(primary: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (m: string) => {
    const x = m.replace(/^models\//, "").trim();
    if (!x || seen.has(x)) return;
    seen.add(x);
    out.push(x);
  };
  add(primary);
  for (const m of GEMINI_FALLBACK_MODELS) add(m);
  return out;
}

/**
 * Receipt vision via Google Gemini API (AI Studio key).
 * https://ai.google.dev/gemini-api/docs
 */
export async function parseReceiptWithGemini(
  env: GeminiEnv,
  imageBytes: Uint8Array,
  mime: string
): Promise<ParsedReceipt> {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is required for Gemini vision");

  const configured = (env.GOOGLE_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL).replace(/^models\//, "").trim() || DEFAULT_GEMINI_MODEL;
  const models = uniqueModels(configured);
  const b64 = bytesToBase64(imageBytes);

  const body = {
    systemInstruction: { parts: [{ text: RECEIPT_SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: RECEIPT_USER_JSON_ONLY },
          {
            inlineData: {
              mimeType: mime || "image/jpeg",
              data: b64
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
      responseMimeType: "application/json"
    }
  };

  let lastErr = "Gemini: no model attempt succeeded";
  for (const model of models) {
    const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const rawText = await res.text();
    if (!res.ok) {
      if (isGeminiModelNotFound(res.status, rawText)) {
        lastErr = `Gemini model "${model}": ${rawText.slice(0, 280)}`;
        continue;
      }
      throw new Error(`Gemini API error ${res.status}: ${rawText.slice(0, 400)}`);
    }

    let json: { error?: { message?: string }; candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try {
      json = JSON.parse(rawText) as typeof json;
    } catch {
      throw new Error(`Gemini invalid JSON response: ${rawText.slice(0, 200)}`);
    }
    if (json.error?.message) throw new Error(json.error.message);

    const parts = json.candidates?.[0]?.content?.parts;
    const text = parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text.trim()) {
      lastErr = `Gemini model "${model}" returned no text parts`;
      continue;
    }

    return parseReceiptModelText(text);
  }

  throw new Error(`${lastErr} Set GOOGLE_GEMINI_MODEL to a model listed at https://ai.google.dev/gemini-api/docs/models`);
}
