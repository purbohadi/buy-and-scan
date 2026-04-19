import { bytesToBase64, parseReceiptModelText, RECEIPT_SYSTEM_PROMPT } from "./receipt-shared";
import type { ParsedReceipt } from "./types";

const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";
const DEFAULT_OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";

function resolveVisionModel(mode: ExternalProvider, configured: string | undefined): string {
  const raw = configured?.trim();
  if (!raw) {
    return mode === "openai" ? DEFAULT_OPENAI_MODEL : DEFAULT_OPENROUTER_MODEL;
  }
  if (mode === "openrouter") {
    if (raw.includes("/")) return raw;
    return `openai/${raw}`;
  }
  if (raw.startsWith("openai/")) return raw.slice("openai/".length);
  if (!raw.includes("/")) return raw;
  return DEFAULT_OPENAI_MODEL;
}

export type ExternalProvider = "openai" | "openrouter";

export type ExternalAiEnv = {
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENROUTER_BASE_URL?: string;
  RECEIPT_VISION_MODEL?: string;
};

/** OpenAI or OpenRouter vision via chat/completions + image_url. */
export async function parseReceiptWithExternalProvider(
  env: ExternalAiEnv,
  imageBytes: Uint8Array,
  mime: string,
  mode: ExternalProvider
): Promise<ParsedReceipt> {
  let apiKey: string;
  let baseUrl: string;
  let model: string;

  if (mode === "openai") {
    apiKey = env.OPENAI_API_KEY ?? "";
    baseUrl = (env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE).replace(/\/$/, "");
    model = resolveVisionModel("openai", env.RECEIPT_VISION_MODEL);
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for OpenAI vision");
  } else {
    apiKey = env.OPENROUTER_API_KEY ?? "";
    baseUrl = (env.OPENROUTER_BASE_URL ?? DEFAULT_OPENROUTER_BASE).replace(/\/$/, "");
    model = resolveVisionModel("openrouter", env.RECEIPT_VISION_MODEL);
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for OpenRouter vision");
  }

  const dataUrl = `data:${mime};base64,${bytesToBase64(imageBytes)}`;
  const userInstruction =
    "Extract structured receipt data as JSON only. If multiple languages, prefer amounts from printed totals.";

  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: RECEIPT_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: userInstruction },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ]
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  if (mode === "openrouter") {
    headers["HTTP-Referer"] = "https://scan-and-parse.local";
    headers["X-Title"] = "Scan & Parse";
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Vision API error ${res.status}: ${t.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
    error?: { message?: string };
  };

  if (json.error?.message) {
    throw new Error(json.error.message);
  }

  const content = json.choices?.[0]?.message?.content;
  let text: string;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("");
  } else {
    throw new Error("Model returned no text content");
  }

  return parseReceiptModelText(text);
}
