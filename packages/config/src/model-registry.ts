import type { OpenRouterModel, ModelRegistryEntry } from "@repo/types";
import { toMicros, toMicrosPerMillion } from "@repo/utils";
import openrouterModelRegistry from "./openrouter-registry.json";

// ─── Helpers ─────────────────────────────────────────────────
function num(v?: string) {
  if (!v) return 0;
  return Number(v);
}

// ─── Mapper ──────────────────────────────────────────────────
export function mapOpenRouterModels(
  models: OpenRouterModel[]
): Record<string, ModelRegistryEntry> {
  const registry: Record<string, ModelRegistryEntry> = {};

  for (const m of models) {
    const inputPrice = toMicrosPerMillion(num(m.pricing?.prompt));
    const outputPrice = toMicrosPerMillion(num(m.pricing?.completion));

    const reasoningPrice = toMicrosPerMillion(num(m.pricing?.internal_reasoning));
    const cacheReadPrice = toMicrosPerMillion(num(m.pricing?.input_cache_read));
    const webSearchPrice = toMicros(num(m.pricing?.web_search));
    const requestPrice = toMicros(num(m.pricing?.request));
    const imagePrice = toMicros(num(m.pricing?.image));

    const maxInput = m.context_length;
    const maxOutput = m.top_provider?.max_completion_tokens ?? 4096;

    const inputWorst = BigInt(maxInput) * inputPrice;
    const outputWorst = BigInt(maxOutput) * outputPrice;
    const reasoningWorst = BigInt(maxOutput) * reasoningPrice;
    const cacheWorst = BigInt(maxInput) * cacheReadPrice;

    // token prices are per 1M tokens → divide back down to micros
    const totalWorst =
      (inputWorst + outputWorst + reasoningWorst + cacheWorst) / 1_000_000n +
      webSearchPrice +
      requestPrice +
      imagePrice;

    registry[m.id] = {
      slug: m.id,
      provider: m.id.split("/")[0] || "unknown",

      tokenizer: m.architecture?.tokenizer ?? "unknown",

      context_window: m.context_length,
      max_input_tokens: maxInput,
      max_output_tokens: maxOutput,

      cost_per_token: {
        input: inputPrice,
        output: outputPrice,
        reasoning: reasoningPrice || undefined,
        cache_read: cacheReadPrice || undefined,
      },

      cost_per_request: {
        web_search: webSearchPrice || undefined,
        request: requestPrice || undefined,
        image: imagePrice || undefined,
      },

      worst_case_cost: totalWorst,
    };
  }

  return registry;
}

// ─── Pre-built registry ──────────────────────────────────────
export const modelRegistry = mapOpenRouterModels(
  (openrouterModelRegistry as any).data
);
