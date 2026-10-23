import dotenv from "dotenv";
import crypto from "crypto";
import express, { type Express, type Request, type Response } from "express";
import { llmRouter } from "./router/llm-router.ts";
import { apiKeyGate } from "./middleware/apiKeyGate.ts";
import { keyRateLimit } from "./middleware/keyRateLimit.ts";
import { chargeUsage } from "./billing/charge.ts";
import type { NormalizedChatRequest } from "@repo/types";

dotenv.config();

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

  private handleChatCompletions = async (
    req: Request,
    res: Response,
  ): Promise<any> => {
    try {
      const data = req.body;

      const normalized = this.normalizeRequest(data);

      console.log("[Chat Completions]", {
        apiKeyId: req.apiKey?.id,
        userId: req.user?.id,
        model: data.model,
      });

      const response = await llmRouter.callLlm(normalized, {
        userId: req.user?.id,
        apiKeyId: req.apiKey?.id,
      });

      // BYOK calls are billed by the provider directly
      if (!normalized.byok && req.user && req.apiKey) {
        try {
          await chargeUsage(req.user.id, req.apiKey.id, response.costMicros);
        } catch (billingError) {
          // the user already got a response — log and don't fail the request
          console.error("[Billing Error]", billingError);
        }
      }

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
        usage: {
          prompt_tokens: response.promptTokens,
          completion_tokens: response.completionTokens,
          total_tokens: response.totalTokens,
          thoughts_tokens: response.thoughtsTokens || undefined,
          cache_read_tokens: response.cacheReadTokens || undefined,
        },
        // cost in micros (1 USD = 1,000,000 micros)
        cost_micros: Number(response.costMicros),
      });
    } catch (error: any) {
      console.error("[Chat Completions Error]", error);

      if (error.name === "ModelNotRegisteredError") {
        res.status(404).json({
          error: {
            message: "model is not registered",
            type: "invalid_request_error",
            param: "model",
            code: "model_not_found"
          }
        });
        return;
      }

      res.status(500).json({ error: "Failed to process request" });
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
