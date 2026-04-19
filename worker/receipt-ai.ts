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
    image: dataUrl
  };
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

  let text = typeof res === "string" ? res : res.response ?? JSON.stringify(res);

  if (isLlamaVisionLicenseGate(text)) {
    await ensureLlamaVisionLicense(ai);
    res = await runVision();
    text = typeof res === "string" ? res : res.response ?? JSON.stringify(res);
    if (isLlamaVisionLicenseGate(text)) {
      throw new Error("Workers AI still requires Meta license acceptance after agree; check Cloudflare Workers AI.");
    }
  }

  const jsonStr = extractJsonObject(text);
  if (!jsonStr) {
    throw new Error("Model did not return parseable JSON");
  }
  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  return normalizeParsed(parsed);
}
