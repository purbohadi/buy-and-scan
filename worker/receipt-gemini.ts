import { bytesToBase64, parseReceiptModelText, RECEIPT_SYSTEM_PROMPT, RECEIPT_USER_JSON_ONLY } from "./receipt-shared";
import type { ParsedReceipt } from "./types";

const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiEnv = {
  GEMINI_API_KEY?: string;
  /** e.g. gemini-2.0-flash, gemini-1.5-flash — from Google AI Studio */
  GOOGLE_GEMINI_MODEL?: string;
};

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

  const model = (env.GOOGLE_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL).replace(/^models\//, "").trim() || DEFAULT_GEMINI_MODEL;
  const b64 = bytesToBase64(imageBytes);
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

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

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${rawText.slice(0, 400)}`);
  }

  const json = JSON.parse(rawText) as {
    error?: { message?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  if (json.error?.message) throw new Error(json.error.message);

  const parts = json.candidates?.[0]?.content?.parts;
  const text = parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("Gemini returned no text parts");

  return parseReceiptModelText(text);
}
