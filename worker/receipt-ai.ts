import {
  bytesToBase64,
  parseReceiptModelText,
  RECEIPT_SYSTEM_PROMPT,
  RECEIPT_USER_JSON_ONLY
} from "./receipt-shared";
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

function visionPayloadBase(dataUrl: string) {
  return {
    messages: [
      { role: "system", content: RECEIPT_SYSTEM_PROMPT },
      { role: "user", content: RECEIPT_USER_JSON_ONLY }
    ],
    image: dataUrl,
    temperature: 0.1,
    max_tokens: 2048
  };
}

async function runVision(ai: Ai, dataUrl: string): Promise<unknown> {
  const base = visionPayloadBase(dataUrl);
  try {
    return await ai.run(VISION_MODEL, {
      ...base,
      response_format: { type: "json_object" }
    } as typeof base & { response_format: { type: "json_object" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/response_format|json_object|unknown|invalid|not support/i.test(msg)) {
      return await ai.run(VISION_MODEL, base);
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

export async function parseReceiptWithWorkersAi(
  ai: Ai,
  imageBytes: Uint8Array,
  mime: string
): Promise<ParsedReceipt> {
  const dataUrl = `data:${mime};base64,${bytesToBase64(imageBytes)}`;

  let res: { response?: string } | string;
  try {
    res = (await runVision(ai, dataUrl)) as { response?: string } | string;
  } catch (e) {
    // Workers AI returns HTTP 403 / internal 5016 as a thrown error, not model text.
    const msg = e instanceof Error ? e.message : String(e);
    if (!isLlamaVisionLicenseGate(msg)) throw e;
    await ensureLlamaVisionLicense(ai);
    res = (await runVision(ai, dataUrl)) as { response?: string } | string;
  }

  let text = workersAiOutputToText(res);

  if (isLlamaVisionLicenseGate(text)) {
    await ensureLlamaVisionLicense(ai);
    res = (await runVision(ai, dataUrl)) as { response?: string } | string;
    text = workersAiOutputToText(res);
    if (isLlamaVisionLicenseGate(text)) {
      throw new Error("Workers AI still requires Meta license acceptance after agree; check Cloudflare Workers AI.");
    }
  }

  try {
    return parseReceiptModelText(text);
  } catch (first) {
    res = (await runVision(ai, dataUrl)) as { response?: string } | string;
    text = workersAiOutputToText(res);
    try {
      return parseReceiptModelText(text);
    } catch {
      const msg = first instanceof Error ? first.message : String(first);
      throw new Error(msg);
    }
  }
}
