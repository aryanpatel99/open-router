// ─── Telemetry Types ─────────────────────────────────────────

export interface StepRequest {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  provider_strategy?: string;
}

export interface StepResponse {
  content: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  thoughtsTokens?: number;
  cacheReadTokens?: number;
  // stored as number (micros) — bigint is not JSON-serialisable
  costMicros?: number;
  finishReason?: string;
  actualModel?: string;
  provider?: string;
}

export interface Step {
  index: number;
  model: string;
  provider: string;
  status: "success" | "error" | "pending";
  startedAt: number;
  completedAt?: number;
  duration?: number;
  request: StepRequest;
  response?: StepResponse;
  error?: string;
}

export interface Run {
  id: string;
  status: "success" | "error" | "pending";
  operation: "chat";
  model: string;
  provider?: string;
  startedAt: number;
  completedAt?: number;
  duration?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  thoughtsTokens?: number;
  cacheReadTokens?: number;
  costMicros?: number;
  userId?: number;
  apiKeyId?: number;
  steps: Step[];
  input: StepRequest;
  error?: string;
}

export interface TelemetryData {
  runs: Run[];
}
