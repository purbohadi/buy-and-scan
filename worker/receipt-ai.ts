import { bytesToBase64, extractJsonObject, normalizeParsed, RECEIPT_SYSTEM_PROMPT } from "./receipt-shared";
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

function visionPayload(dataUrl: string) {
  return {
    messages: [
      { role: "system", content: RECEIPT_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "Extract structured receipt data as JSON only. If multiple languages, prefer amounts from printed totals."
      }
    ],
    image: dataUrl,
    temperature: 0.1,
    max_tokens: 2048
  };
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

function parseReceiptJsonFromModelText(text: string): ParsedReceipt {
  const jsonStr = extractJsonObject(text);
  if (!jsonStr) {
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 280);
    throw new Error(
      `Model did not return parseable JSON (preview: ${preview || "(empty)"})`
    );
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    throw new Error("Model returned invalid JSON");
  }
  return normalizeParsed(parsed);
}

export async function parseReceiptWithWorkersAi(
  ai: Ai,
  imageBytes: Uint8Array,
  mime: string
): Promise<ParsedReceipt> {
  const dataUrl = `data:${mime};base64,${bytesToBase64(imageBytes)}`;

  const runVision = async () =>
    (await ai.run(VISION_MODEL, visionPayload(dataUrl))) as { response?: string };

  let res: { response?: string } | string;
  try {
    res = await runVision();
  } catch (e) {
    // Workers AI returns HTTP 403 / internal 5016 as a thrown error, not model text.
    const msg = e instanceof Error ? e.message : String(e);
    if (!isLlamaVisionLicenseGate(msg)) throw e;
    await ensureLlamaVisionLicense(ai);
    res = await runVision();
  }

  let text = workersAiOutputToText(res);

  if (isLlamaVisionLicenseGate(text)) {
    await ensureLlamaVisionLicense(ai);
    res = await runVision();
    text = workersAiOutputToText(res);
    if (isLlamaVisionLicenseGate(text)) {
      throw new Error("Workers AI still requires Meta license acceptance after agree; check Cloudflare Workers AI.");
    }
  }

  try {
    return parseReceiptJsonFromModelText(text);
  } catch (first) {
    res = await runVision();
    text = workersAiOutputToText(res);
    try {
      return parseReceiptJsonFromModelText(text);
    } catch {
      const msg = first instanceof Error ? first.message : String(first);
      throw new Error(msg);
    }
  }
}
