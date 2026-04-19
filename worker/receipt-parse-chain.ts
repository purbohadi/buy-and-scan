import type { ParsedReceipt } from "./types";
import { parseReceiptWithWorkersAi } from "./receipt-ai";
import { parseReceiptWithExternalProvider, type ExternalAiEnv, type ExternalProvider } from "./receipt-openai";

export type ParseChainEnv = ExternalAiEnv & { AI: Ai };

type Step = "openai" | "openrouter" | "workers";

function hasKey(env: ExternalAiEnv, step: Step): boolean {
  if (step === "workers") return true;
  if (step === "openai") return Boolean(env.OPENAI_API_KEY?.trim());
  return Boolean(env.OPENROUTER_API_KEY?.trim());
}

/** Fixed order: OpenAI (if key) → OpenRouter (if key) → Cloudflare Workers AI. */
function buildChain(env: ParseChainEnv): Step[] {
  const chain: Step[] = [];
  if (hasKey(env, "openai")) chain.push("openai");
  if (hasKey(env, "openrouter")) chain.push("openrouter");
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
      if (step === "workers") {
        return await parseReceiptWithWorkersAi(env.AI, imageBytes, mime);
      }
      return await parseReceiptWithExternalProvider(env, imageBytes, mime, step as ExternalProvider);
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
