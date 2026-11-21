// must be the first import: @repo/db reads DATABASE_URL when it is imported
import "dotenv/config";
import crypto from "crypto";
import express, { type Express, type Request, type Response } from "express";
import { llmRouter } from "./router/llm-router.ts";
import type { ProviderResponse } from "./providers/gemini-provider.ts";
import { apiKeyGate } from "./middleware/apiKeyGate.ts";
import { keyRateLimit } from "./middleware/keyRateLimit.ts";
import { chargeUsage } from "./billing/charge.ts";
import type { NormalizedChatRequest } from "@repo/types";

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set. Check your .env file.");
  process.exit(1);
}

class ApiGateway {
  private app: Express;
  private port: number;

  constructor() {
    this.app = express();
    this.port = Number(process.env.PORT) || 3001;

    this.middleware();
    this.routes();
  }

  private middleware(): void {
    this.app.use(express.json());
  }

  private routes(): void {
    // Health check for browsers
    this.app.get("/", (_req: Request, res: Response) => {
      res.json({
        status: "online",
        service: "api-gateway",
        message: "Send POST requests to /chat/completions"
      });
    });

    // OpenAI SDK standard path with API key verification
    this.app.post("/v1/chat/completions", apiKeyGate, keyRateLimit, this.handleChatCompletions);

    this.app.post("/chat/completions", apiKeyGate, keyRateLimit, this.handleChatCompletions);
  }

  private normalizeRequest(data: any): NormalizedChatRequest {
    const mainModel = data.model;
    const fallbackModels = data.extra?.fallback_models || [];
    const model_slugs = [mainModel, ...fallbackModels].filter(Boolean);

    return {
      model_slug: model_slugs,
      messages: data.messages || [],
      temperature: data.temperature ?? 0.7,
      retry: typeof data.extra?.retry === "number" ? data.extra.retry : undefined,
      provider: data.extra?.provider ?? "cheap",
      streaming: data.stream ?? false,
      preset: data.extra?.preset ?? false,
      message_transform: data.extra?.message_transform ?? false,
      byok: typeof data.extra?.byok === "string" && data.extra.byok.trim()
        ? data.extra.byok.trim()
        : undefined,
    };
  }

  private usageOf(response: ProviderResponse) {
    return {
      prompt_tokens: response.promptTokens,
      completion_tokens: response.completionTokens,
      total_tokens: response.totalTokens,
      thoughts_tokens: response.thoughtsTokens || undefined,
      cache_read_tokens: response.cacheReadTokens || undefined,
    };
  }

  // BYOK calls are billed by the provider directly
  private async bill(req: Request, normalized: NormalizedChatRequest, response: ProviderResponse) {
    if (normalized.byok || !req.user || !req.apiKey) return;
    try {
      await chargeUsage(req.user.id, req.apiKey.id, response.costMicros);
    } catch (billingError) {
      // the user already got a response — log and don't fail the request
      console.error("[Billing Error]", billingError);
    }
  }

  private sendError(res: Response, error: any): void {
    if (error?.name === "ModelNotRegisteredError") {
      res.status(404).json({
        error: {
          message: "model is not registered",
          type: "invalid_request_error",
          param: "model",
          code: "model_not_found",
        },
      });
      return;
    }

    res.status(500).json({ error: "Failed to process request" });
  }

  private handleChatCompletions = async (
    req: Request,
    res: Response,
  ): Promise<any> => {
    const normalized = this.normalizeRequest(req.body);

    console.log("[Chat Completions]", {
      apiKeyId: req.apiKey?.id,
      userId: req.user?.id,
      model: req.body?.model,
      stream: normalized.streaming,
    });

    if (normalized.streaming) {
      return this.handleStream(req, res, normalized);
    }

    try {
      const response = await llmRouter.callLlm(normalized, {
        userId: req.user?.id,
        apiKeyId: req.apiKey?.id,
      });

      await this.bill(req, normalized, response);

      res.json({
        id: `chatcmpl-${crypto.randomUUID()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: normalized.model_slug[0],
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: response.content,
            },
            finish_reason: response.finishReason || "stop",
          },
        ],
        usage: this.usageOf(response),
        // cost in micros (1 USD = 1,000,000 micros)
        cost_micros: Number(response.costMicros),
      });
    } catch (error: any) {
      console.error("[Chat Completions Error]", error);
      this.sendError(res, error);
    }
  };

  // ─── Streaming (SSE, OpenAI chat.completion.chunk format) ─────
  // Headers are sent lazily on the first token, so failures before any
  // output still get a normal HTTP error status and full retry/fallback.
  private handleStream = async (
    req: Request,
    res: Response,
    normalized: NormalizedChatRequest,
  ): Promise<void> => {
    const id = `chatcmpl-${crypto.randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);
    const model = normalized.model_slug[0];

    const chunk = (delta: object, finishReason: string | null = null, extra: object = {}) => ({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...extra,
    });
    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    let started = false;
    const startStream = () => {
      if (started) return;
      started = true;
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering
      res.flushHeaders();
      send(chunk({ role: "assistant", content: "" }));
    };

    // stop generating (and paying for) tokens if the client goes away
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });

    try {
      const response = await llmRouter.callLlm(
        normalized,
        { userId: req.user?.id, apiKeyId: req.apiKey?.id },
        {
          signal: abort.signal,
          onDelta: (text) => {
            startStream();
            send(chunk({ content: text }));
          },
        },
      );

      await this.bill(req, normalized, response);
      if (abort.signal.aborted) return;

      startStream(); // model returned no text at all
      send(
        chunk({}, response.finishReason || "stop", {
          usage: this.usageOf(response),
          cost_micros: Number(response.costMicros),
        }),
      );
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      if (abort.signal.aborted) {
        console.log("[Stream] client disconnected", { id });
        return;
      }

      console.error("[Chat Completions Stream Error]", error);

      if (!started) {
        this.sendError(res, error);
        return;
      }

      // mid-stream failure: headers are gone, report in-band like OpenAI
      send({
        error: {
          message: "Stream interrupted: upstream provider failed mid-response",
          type: "server_error",
          code: "stream_interrupted",
        },
      });
      res.write("data: [DONE]\n\n");
      res.end();
    }
  };

  start(): void {
    this.app.listen(this.port, () => {
      console.log(`API Gateway running at http://localhost:${this.port}`);
      console.log(`POST http://localhost:${this.port}/chat/completions`);
    });
  }
}

const gateway = new ApiGateway();
gateway.start();
