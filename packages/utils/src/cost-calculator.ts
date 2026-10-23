import type { ModelRegistryEntry } from "@repo/types";
import { modelRegistry } from "@repo/config";

// ─── Usage Metadata (from Gemini / generic provider) ─────────
export interface UsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
  cacheReadTokenCount?: number;
}

// ─── Cost Calculator ─────────────────────────────────────────
/**
 * Calculate the cost of an LLM call based on token usage and
 * the model registry pricing data.
 *
 * @param modelSlug - The full slug (e.g. "google/gemini-2.5-pro")
 *                    or just the provider-prefixed version.
 *                    If only a bare model name is provided,
 *                    pass `providerPrefix` to prepend it.
 * @param usage     - Token counts from the provider's response
 * @param providerPrefix - Optional prefix (e.g. "google/") to prepend
 * @returns Total cost in micros (bigint, rounded up), or 0n if model not found
 */
export function costCalculation(
  modelSlug: string,
  usage: UsageMetadata,
  providerPrefix?: string
): bigint {
  const fullSlug = providerPrefix
    ? `${providerPrefix}${modelSlug}`
    : modelSlug;

  const entry: ModelRegistryEntry | undefined = modelRegistry[fullSlug];

  if (!entry) {
    console.warn(`[cost-calculator] Model "${fullSlug}" not found in registry`);
    return BigInt(0);
  }

  const { cost_per_token } = entry;

  // promptTokenCount includes cached tokens — bill those at the cache rate
  const cached = BigInt(usage.cacheReadTokenCount || 0);
  const uncachedPrompt = BigInt(usage.promptTokenCount) - cached;

  // prices are micros per 1M tokens
  const scaled =
    (uncachedPrompt > 0n ? uncachedPrompt : 0n) * BigInt(cost_per_token.input) +
    BigInt(usage.candidatesTokenCount) * BigInt(cost_per_token.output) +
    BigInt(usage.thoughtsTokenCount || 0) *
      BigInt(cost_per_token.reasoning ?? cost_per_token.output) +
    cached * BigInt(cost_per_token.cache_read ?? cost_per_token.input);

  // round up so tiny requests are never free
  return (scaled + 999_999n) / 1_000_000n;
}
