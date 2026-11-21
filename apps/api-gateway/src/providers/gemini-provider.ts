import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { costCalculation } from "@repo/utils";
import type { ChatMessage } from "@repo/types";

// ─── Structured response all providers must return ────────────
export interface ProviderResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  thoughtsTokens: number;
  cacheReadTokens: number;
  costMicros: bigint;
  finishReason: string;
  modelVersion: string;
}

export interface ProviderOptions {
  temperature?: number;
  signal?: AbortSignal;
}

// called with each text delta while a response streams
export type DeltaHandler = (text: string) => void;

// ─── Provider contract ────────────────────────────────────────
export interface AIProvider {
  providerName: string;
  generateChat(
    modelSlug: string,
    messages: ChatMessage[],
    options: ProviderOptions,
    apiKey: string,
  ): Promise<ProviderResponse>;
  // emits deltas as they arrive, resolves with the full response + usage
  streamChat(
    modelSlug: string,
    messages: ChatMessage[],
    options: ProviderOptions,
    apiKey: string,
    onDelta: DeltaHandler,
  ): Promise<ProviderResponse>;
}

// Gemini finish reasons → OpenAI finish_reason values
function toOpenAIFinishReason(reason?: string): string {
  switch (reason) {
    case undefined:
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "content_filter";
    default:
      return reason.toLowerCase();
  }
}

// ─── Gemini implementation ────────────────────────────────────
export class GeminiProvider implements AIProvider {
  providerName = "gemini";

  private buildRequest(modelSlug: string, messages: ChatMessage[], options: ProviderOptions) {
    const system =
      messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n") || "You are a helpful assistant.";

    // Gemini uses "model" for assistant turns; keep full history in order
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    return {
      model: modelSlug,
      contents,
      config: {
        systemInstruction: system,
        temperature: options?.temperature,
        abortSignal: options?.signal,
      },
    };
  }

  private buildResponse(
    modelSlug: string,
    content: string,
    last: GenerateContentResponse | undefined,
    usageMetadata: GenerateContentResponse["usageMetadata"],
    finishReason: string | undefined,
  ): ProviderResponse {
    const usage = (usageMetadata ?? {}) as {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
      thoughtsTokenCount?: number;
      cachedContentTokenCount?: number;
    };

    const promptTokens = usage.promptTokenCount ?? 0;
    const completionTokens = usage.candidatesTokenCount ?? 0;
    const totalTokens = usage.totalTokenCount ?? 0;
    const thoughtsTokens = usage.thoughtsTokenCount ?? 0;
    const cacheReadTokens = usage.cachedContentTokenCount ?? 0;

    const costMicros = costCalculation(
      modelSlug,
      {
        promptTokenCount: promptTokens,
        candidatesTokenCount: completionTokens,
        thoughtsTokenCount: thoughtsTokens,
        cacheReadTokenCount: cacheReadTokens,
      },
      "google/",
    );

    return {
      content,
      promptTokens,
      completionTokens,
      totalTokens,
      thoughtsTokens,
      cacheReadTokens,
      costMicros,
      finishReason: toOpenAIFinishReason(finishReason),
      modelVersion: last?.modelVersion ?? modelSlug,
    };
  }

  async generateChat(
    modelSlug: string,
    messages: ChatMessage[],
    options: ProviderOptions,
    apiKey: string,
  ): Promise<ProviderResponse> {
    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.generateContent(
      this.buildRequest(modelSlug, messages, options),
    );

    return this.buildResponse(
      modelSlug,
      response.text ?? "",
      response,
      response.usageMetadata,
      response.candidates?.[0]?.finishReason?.toString(),
    );
  }

  async streamChat(
    modelSlug: string,
    messages: ChatMessage[],
    options: ProviderOptions,
    apiKey: string,
    onDelta: DeltaHandler,
  ): Promise<ProviderResponse> {
    const client = new GoogleGenAI({ apiKey });
    const stream = await client.models.generateContentStream(
      this.buildRequest(modelSlug, messages, options),
    );

    let content = "";
    let last: GenerateContentResponse | undefined;
    let usageMetadata: GenerateContentResponse["usageMetadata"];
    let finishReason: string | undefined;

    for await (const chunk of stream) {
      last = chunk;
      // usage arrives on the final chunk(s); keep the latest
      if (chunk.usageMetadata) usageMetadata = chunk.usageMetadata;
      const reason = chunk.candidates?.[0]?.finishReason;
      if (reason) finishReason = reason.toString();

      const text = chunk.text;
      if (text) {
        content += text;
        onDelta(text);
      }
    }

    return this.buildResponse(modelSlug, content, last, usageMetadata, finishReason);
  }
}
