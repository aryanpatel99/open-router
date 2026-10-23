// ─── Provider Strategy ───────────────────────────────────────
export type ProviderStrategy = "cheap" | "latency" | "throughput" | "auto";

// ─── Chat Message ────────────────────────────────────────────
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─── Normalized Chat Request ─────────────────────────────────
export interface NormalizedChatRequest {
  model_slug: string[];
  messages: ChatMessage[];

  temperature: number;
  // number of retries per provider; undefined → gateway default
  retry?: number;

  provider: ProviderStrategy;
  streaming: boolean;

  preset: boolean;
  message_transform: boolean;

  byok?: string;
}
