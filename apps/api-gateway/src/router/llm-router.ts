import {
  type AIProvider,
  type ProviderResponse,
  type DeltaHandler,
  GeminiProvider,
} from "../providers/gemini-provider.ts";
import type { NormalizedChatRequest } from "@repo/types";
import { modelProvider } from "@repo/config";
import { messageTransformer } from "../transform/message-transformer.ts";
import { RetryHandler, type RetryPolicy, DEFAULT_RETRY_POLICY } from "./retry-handler.ts";
import { getProviderStrategy } from "./provider-strategy.ts";
import { decide, RouterAction } from "./decision-engine.ts";
import { TelemetryCollector, type RunOwner } from "../telemetry/collector.ts";
import "dotenv/config";

// cap user-supplied retries so one request can't hammer a provider
const MAX_USER_RETRIES = 5;

export interface CallOptions {
  // set → stream the response, calling onDelta with each text chunk
  onDelta?: DeltaHandler;
  // aborted when the client disconnects
  signal?: AbortSignal;
}

// Thrown once output has already reached the client: retrying or falling
// back would send a second, different answer, so the router must stop.
export class StreamInterruptedError extends Error {
  constructor(cause: unknown) {
    super((cause as Error)?.message || String(cause));
    this.name = "StreamInterruptedError";
    this.cause = cause;
  }
}

export class LLMRouter {
  private providers: Map<string, AIProvider>;
  private retryHandler: RetryHandler;

  constructor(retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY) {
    this.providers = new Map();
    this.providers.set("google", new GeminiProvider());
    this.retryHandler = new RetryHandler(retryPolicy);
  }

  private returnUserError(error: any) {
    throw error;
  }

  private crashAndFixDev(error: any) {
    throw error;
  }

  private maxAttemptsFor(normalized: NormalizedChatRequest): number {
    if (normalized.retry === undefined) return this.retryHandler.maxAttempts;
    const retries = Math.min(Math.max(Math.floor(normalized.retry), 0), MAX_USER_RETRIES);
    return retries + 1;
  }

  private getApiKey(byok?: string): string {
    if (byok) return byok;
    const key = process.env.GEMINI_API_KEY || "";
    if (!key) {
      throw new Error("API Key is missing in environment variables.");
    }
    return key;
  }

  private async executeWithRetry(
    providerInstance: AIProvider,
    modelName: string,
    normalized: NormalizedChatRequest,
    collector: TelemetryCollector,
    providerName: string,
    callOptions: CallOptions,
  ): Promise<ProviderResponse> {
    let lastError: any;
    const maxAttempts = this.maxAttemptsFor(normalized);
    const { onDelta, signal } = callOptions;
    const providerOptions = { temperature: normalized.temperature, signal };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const stepIndex = collector.startStep(modelName, providerName, {
        model: modelName,
        messages: normalized.messages,
        temperature: normalized.temperature,
        provider_strategy: normalized.provider,
      });

      let emitted = false;

      try {
        const apiKey = this.getApiKey(normalized.byok);
        if (normalized.byok) {
          console.log(`[BYOK] Using user-provided API key for ${modelName}`);
        }

        const result = onDelta
          ? await providerInstance.streamChat(
              modelName,
              normalized.messages,
              providerOptions,
              apiKey,
              (text) => {
                emitted = true;
                onDelta(text);
              },
            )
          : await providerInstance.generateChat(
              modelName,
              normalized.messages,
              providerOptions,
              apiKey,
            );

        collector.completeStep(stepIndex, {
          content: result.content,
          provider: providerName,
          actualModel: result.modelVersion,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          totalTokens: result.totalTokens,
          thoughtsTokens: result.thoughtsTokens,
          cacheReadTokens: result.cacheReadTokens,
          costMicros: Number(result.costMicros),
          finishReason: result.finishReason,
        });

        return result;
      } catch (error) {
        lastError = error;
        collector.failStep(stepIndex, (error as Error).message || String(error));

        // tokens already sent, or the client left: no retry, no fallback
        if (emitted || signal?.aborted) {
          throw new StreamInterruptedError(error);
        }

        const action = decide(error, attempt, maxAttempts);

        if (action === RouterAction.FAIL_USER) {
          this.returnUserError(error);
        }

        if (action === RouterAction.FAIL_DEV) {
          this.crashAndFixDev(error);
        }

        if (action === RouterAction.FALLBACK_PROVIDER) {
          throw error;
        }

        const delay = this.retryHandler.computeDelay(attempt);
        console.log(`[Retry] ${modelName} attempt ${attempt + 1} → ${delay}ms`);
        await this.retryHandler.sleep(delay);
      }
    }

    throw lastError;
  }

  async callLlm(
    normalized: NormalizedChatRequest,
    owner: RunOwner = {},
    callOptions: CallOptions = {},
  ): Promise<ProviderResponse> {
    const collector = new TelemetryCollector(
      {
        model: normalized.model_slug.join(", "),
        messages: normalized.messages,
        temperature: normalized.temperature,
        provider_strategy: normalized.provider,
      },
      owner,
    );

    console.log(`\n[Stage 1: Routing Start] Models: ${normalized.model_slug.join(", ")}`);

    try {
      let missingModels = 0;

      for (const model of normalized.model_slug) {
        const modelName = model.split("/")[1];
        console.log(`\n[Stage 2: Model Selection] Attempting model: ${modelName}`);

        const modelConfig = modelName && modelProvider[modelName];

        if (!modelConfig) {
          console.log(`[Model Fail] ${modelName} is completely missing from config`);
          missingModels++;
          continue;
        }

        const providerList = getProviderStrategy(modelConfig, normalized.provider);
        console.log(
          `[Stage 3: Provider Strategy] '${normalized.provider}'. Providers: ${providerList.map((p) => p.provider).join(", ")}`,
        );

        for (const providerMeta of providerList) {
          const providerInstance = this.providers.get(providerMeta.provider);
          if (!providerInstance) continue;

          try {
            let messages = normalized.messages;
            if (normalized.message_transform) {
              messages = messageTransformer.transform(messages, modelConfig.max_tokens);
            }

            console.log(`[Stage 5: Execution] Calling ${providerMeta.provider} -> ${modelName}`);
            const response = await this.executeWithRetry(
              providerInstance,
              modelName,
              { ...normalized, messages },
              collector,
              providerMeta.provider,
              callOptions,
            );

            console.log(`[Stage 6: Success] Response received from ${providerMeta.provider}`);

            collector.completeRun({
              content: response.content,
              provider: providerMeta.provider,
              actualModel: response.modelVersion,
              promptTokens: response.promptTokens,
              completionTokens: response.completionTokens,
              totalTokens: response.totalTokens,
              thoughtsTokens: response.thoughtsTokens,
              cacheReadTokens: response.cacheReadTokens,
              costMicros: Number(response.costMicros),
              finishReason: response.finishReason,
            });

            return response;
          } catch (error) {
            if (error instanceof StreamInterruptedError) throw error;

            // retries are already exhausted inside executeWithRetry, so
            // classify this as the final attempt (retryable → fallback)
            const action = decide(error, Infinity, 1);

            console.log(
              `[Provider Fail] ${providerMeta.provider} → ${modelName} → ${action} | Error: ${(error as any).message || error}`,
            );

            if (action === RouterAction.FAIL_USER) {
              this.returnUserError(error);
            }

            if (action === RouterAction.FAIL_DEV) {
              this.crashAndFixDev(error);
            }

            continue;
          }
        }

        console.log(`[Model Fail] ${modelName} exhausted`);
      }

      if (missingModels === normalized.model_slug.length) {
        const err = new Error("model is not registered");
        err.name = "ModelNotRegisteredError";
        throw err;
      }

      throw new Error("All models and providers failed.");
    } catch (error) {
      collector.failRun((error as Error).message || String(error));
      throw error;
    }
  }
}

export const llmRouter = new LLMRouter();
