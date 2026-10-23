import { GoogleGenAI } from "@google/genai";
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

// ─── Provider contract ────────────────────────────────────────
export interface AIProvider {
  providerName: string;
  generateChat(
    modelSlug: string,
    messages: ChatMessage[],
    options: any,
    apiKey: string,
  ): Promise<ProviderResponse>;
}

// ─── Gemini implementation ────────────────────────────────────
export class GeminiProvider implements AIProvider {
  providerName = "gemini";

  async generateChat(
    modelSlug: string,
    messages: ChatMessage[],
    options: any,
    apiKey: string,
  ): Promise<ProviderResponse> {
    const client = new GoogleGenAI({ apiKey });

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

    const response = await client.models.generateContent({
      model: modelSlug,
      contents,
      config: {
        systemInstruction: system,
        temperature: options?.temperature,
      },
    });

    const usage = (response.usageMetadata ?? {}) as {
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
      content: response.text ?? "",
      promptTokens,
      completionTokens,
      totalTokens,
      thoughtsTokens,
      cacheReadTokens,
      costMicros,
      finishReason: response.candidates?.[0]?.finishReason?.toString() ?? "stop",
      modelVersion: response.modelVersion ?? modelSlug,
    };
  }
}
