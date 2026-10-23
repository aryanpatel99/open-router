// ─── Cost Per Token ──────────────────────────────────────────
// Prices are micros per 1M tokens (USD/token × 1e12). Per-token micros
// would round cheap models (e.g. $0.0000003/token = 0.3µ) down to 0.
export interface CostPerToken {
  input: bigint;
  output: bigint;
  reasoning?: bigint;
  cache_read?: bigint;
}

// ─── Cost Per Request ────────────────────────────────────────
export interface CostPerRequest {
  web_search?: bigint;
  request?: bigint;
  image?: bigint;
}

// ─── Model Registry Entry ────────────────────────────────────
export interface ModelRegistryEntry {
  slug: string;
  provider: string;
  tokenizer: string;

  context_window: number;
  max_input_tokens: number;
  max_output_tokens: number;

  cost_per_token: CostPerToken;
  cost_per_request: CostPerRequest;

  worst_case_cost: bigint;
}

// ─── OpenRouter Raw Model (API shape) ────────────────────────
export interface OpenRouterModel {
  id: string;
  context_length: number;
  architecture?: { tokenizer?: string };
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
    request?: string;
    internal_reasoning?: string;
    input_cache_read?: string;
    web_search?: string;
  };
  top_provider?: {
    max_completion_tokens?: number | null;
  };
}
