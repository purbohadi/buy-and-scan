import {
  bytesToBase64,
  parseReceiptModelText,
  RECEIPT_SYSTEM_PROMPT,
  RECEIPT_USER_JSON_ITEMS_TOTAL,
  RECEIPT_USER_JSON_ONLY
} from "./receipt-shared";
import { isTriviallyEmptyReceipt } from "./receipt-quality";
import type { ParsedReceipt } from "./types";

const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

/** Meta / Cloudflare: first use per account must send `{ prompt: "agree" }` before vision calls. */
function isLlamaVisionLicenseGate(text: string): boolean {
  return (
    text.includes("5016") ||
    (text.includes("agree") && text.includes("Community License")) ||
    text.includes("Prior to using this model")
  );
}

async function ensureLlamaVisionLicense(ai: Ai): Promise<void> {
  await ai.run(VISION_MODEL, { prompt: "agree" });
}

type VisionAttempt = { useJsonMode: boolean; userContent: string };

function buildPayload(dataUrl: string, attempt: VisionAttempt) {
  const base = {
    messages: [
      { role: "system", content: RECEIPT_SYSTEM_PROMPT },
      { role: "user", content: attempt.userContent }
    ],
    image: dataUrl,
    temperature: 0.15,
    max_tokens: 4096
  };
  if (!attempt.useJsonMode) return base;
  return { ...base, response_format: { type: "json_object" } as const };
}

async function runVision(ai: Ai, dataUrl: string, attempt: VisionAttempt): Promise<unknown> {
  const payload = buildPayload(dataUrl, attempt);
  if (!attempt.useJsonMode) {
    return await ai.run(VISION_MODEL, payload);
  }
  try {
    return await ai.run(VISION_MODEL, payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/response_format|json_object|unknown|invalid|not support/i.test(msg)) {
      return await ai.run(VISION_MODEL, {
        messages: payload.messages,
        image: payload.image,
        temperature: payload.temperature,
        max_tokens: payload.max_tokens
      });
    }
    throw e;
  }
}

function workersAiOutputToText(res: unknown): string {
  if (typeof res === "string") return res;
  if (!res || typeof res !== "object") return String(res);
  const o = res as Record<string, unknown>;
  if (typeof o.response === "string") return o.response;
  const choices = o.choices;
  if (Array.isArray(choices) && choices[0] && typeof choices[0] === "object") {
    const msg = (choices[0] as { message?: { content?: unknown } }).message;
    const content = msg?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((c): c is { type?: string; text?: string } => c != null && typeof c === "object")
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text!)
        .join("");
    }
  }
  return JSON.stringify(res);
}

const WORKERS_ATTEMPTS: VisionAttempt[] = [
  // json_object can make Llama return {} — try plain generation first
  { useJsonMode: false, userContent: RECEIPT_USER_JSON_ONLY },
  { useJsonMode: false, userContent: RECEIPT_USER_JSON_ITEMS_TOTAL },
  { useJsonMode: true, userContent: RECEIPT_USER_JSON_ONLY },
  { useJsonMode: true, userContent: RECEIPT_USER_JSON_ITEMS_TOTAL }
];

export async function parseReceiptWithWorkersAi(
  ai: Ai,
  imageBytes: Uint8Array,
  mime: string
): Promise<ParsedReceipt> {
  const dataUrl = `data:${mime};base64,${bytesToBase64(imageBytes)}`;

  const runWithLicenseRetry = async (attempt: VisionAttempt): Promise<unknown> => {
    try {
      return await runVision(ai, dataUrl, attempt);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!isLlamaVisionLicenseGate(msg)) throw e;
      await ensureLlamaVisionLicense(ai);
      return await runVision(ai, dataUrl, attempt);
    }
  };

  let lastError: Error | null = null;

  for (const attempt of WORKERS_ATTEMPTS) {
    let res = await runWithLicenseRetry(attempt);
    let text = workersAiOutputToText(res);

    if (isLlamaVisionLicenseGate(text)) {
      await ensureLlamaVisionLicense(ai);
      res = await runVision(ai, dataUrl, attempt);
      text = workersAiOutputToText(res);
      if (isLlamaVisionLicenseGate(text)) {
        lastError = new Error("Workers AI still requires Meta license acceptance after agree.");
        continue;
      }
    }

    try {
      const draft = parseReceiptModelText(text);
      if (!isTriviallyEmptyReceipt(draft)) return draft;
      lastError = new Error(
        "Model returned empty JSON (no items/total). Try JPEG/PNG (not HEIC), full resolution, or set OPENROUTER_API_KEY on the Worker."
      );
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw lastError ?? new Error("Workers AI receipt parse failed after retries.");
}
