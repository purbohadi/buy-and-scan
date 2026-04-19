import type { ParsedReceipt } from "./types";
import { parseReceiptWithWorkersAi } from "./receipt-ai";
import { parseReceiptWithExternalProvider, type ExternalAiEnv, type ExternalProvider } from "./receipt-openai";

export type ParseChainEnv = ExternalAiEnv & { AI: Ai; RECEIPT_AI_FALLBACK_CHAIN?: string };

type Step = "openai" | "openrouter" | "workers";

function explicitMode(provider: string | undefined): Step | "auto" {
  const p = (provider ?? "").toLowerCase().trim();
  if (p === "workers") return "workers";
  if (p === "openai") return "openai";
  if (p === "openrouter") return "openrouter";
  return "auto";
}

function parseChainFromVar(raw: string | undefined): Step[] {
  if (!raw?.trim()) return [];
  const out: Step[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim().toLowerCase();
    if (t === "openai" || t === "openrouter" || t === "workers") out.push(t);
  }
  return out;
}

function hasKey(env: ExternalAiEnv, step: Step): boolean {
  if (step === "workers") return true;
  if (step === "openai") return Boolean(env.OPENAI_API_KEY?.trim());
  return Boolean(env.OPENROUTER_API_KEY?.trim());
}

function buildChain(env: ParseChainEnv): Step[] {
  const mode = explicitMode(env.RECEIPT_AI_PROVIDER);

  if (mode === "workers") return ["workers"];
  if (mode === "openai") {
    if (!hasKey(env, "openai")) throw new Error("RECEIPT_AI_PROVIDER=openai but OPENAI_API_KEY is not set");
    return ["openai"];
  }
  if (mode === "openrouter") {
    if (!hasKey(env, "openrouter")) throw new Error("RECEIPT_AI_PROVIDER=openrouter but OPENROUTER_API_KEY is not set");
    return ["openrouter"];
  }

  // auto (default): OpenAI first when key present, then OpenRouter when key present, then Workers AI
  const custom = parseChainFromVar(env.RECEIPT_AI_FALLBACK_CHAIN);
  if (custom.length > 0) {
    for (const step of custom) {
      if (!hasKey(env, step)) {
        throw new Error(`RECEIPT_AI_FALLBACK_CHAIN includes "${step}" but the required API key is not configured`);
      }
    }
    return custom;
  }

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
      return await parseReceiptWithExternalProvider(env, imageBytes, mime, step);
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
