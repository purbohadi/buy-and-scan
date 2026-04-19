import type { ParsedReceipt } from "./types";
import { parseReceiptWithWorkersAi } from "./receipt-ai";
import { parseReceiptWithGemini, type GeminiEnv } from "./receipt-gemini";
import { parseReceiptWithExternalProvider, type ExternalAiEnv, type ExternalProvider } from "./receipt-openai";
import { isTriviallyEmptyReceipt } from "./receipt-quality";

export type ParseChainEnv = ExternalAiEnv & GeminiEnv & { AI: Ai };

type Step = "openai" | "openrouter" | "gemini" | "workers";

function hasKey(env: ParseChainEnv, step: Step): boolean {
  if (step === "workers") return true;
  if (step === "openai") return Boolean(env.OPENAI_API_KEY?.trim());
  if (step === "gemini") return Boolean(env.GEMINI_API_KEY?.trim());
  return Boolean(env.OPENROUTER_API_KEY?.trim());
}

/** Fixed order: OpenRouter → OpenAI → Gemini (if GEMINI_API_KEY) → Workers AI. */
function buildChain(env: ParseChainEnv): Step[] {
  const chain: Step[] = [];
  if (hasKey(env, "openrouter")) chain.push("openrouter");
  if (hasKey(env, "openai")) chain.push("openai");
  if (hasKey(env, "gemini")) chain.push("gemini");
  chain.push("workers");
  return chain;
}

export async function parseReceiptWithFallback(
  env: ParseChainEnv,
  imageBytes: Uint8Array,
  mime: string
): Promise<ParsedReceipt> {
  const chain = buildChain(env);
  const errors: string[] = [];

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    const isLast = i === chain.length - 1;
    try {
      let draft: ParsedReceipt;
      if (step === "workers") {
        draft = await parseReceiptWithWorkersAi(env.AI, imageBytes, mime);
      } else if (step === "gemini") {
        draft = await parseReceiptWithGemini(env, imageBytes, mime);
      } else {
        draft = await parseReceiptWithExternalProvider(env, imageBytes, mime, step as ExternalProvider);
      }
      if (isTriviallyEmptyReceipt(draft)) {
        throw new Error(
          "Model returned an empty receipt (no items or totals). Use JPEG/PNG (not HEIC), full-resolution photo, or configure OPENROUTER_API_KEY / OPENAI_API_KEY on the Worker for better vision."
        );
      }
      return draft;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${step}: ${msg}`);
      if (isLast) {
        throw new Error(`Receipt parse failed after ${chain.join(" → ")}: ${errors.join(" | ")}`);
      }
    }
  }

  throw new Error("Receipt parse chain was empty");
}
