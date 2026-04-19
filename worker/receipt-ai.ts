import { bytesToBase64, extractJsonObject, normalizeParsed, RECEIPT_SYSTEM_PROMPT } from "./receipt-shared";
import type { ParsedReceipt } from "./types";

const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

export async function parseReceiptWithWorkersAi(
  ai: Ai,
  imageBytes: Uint8Array,
  mime: string
): Promise<ParsedReceipt> {
  const dataUrl = `data:${mime};base64,${bytesToBase64(imageBytes)}`;

  const res = (await ai.run(VISION_MODEL, {
    messages: [
      { role: "system", content: RECEIPT_SYSTEM_PROMPT },
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
