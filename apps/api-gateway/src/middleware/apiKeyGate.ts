import type { Request, Response, NextFunction } from "express";
import { prisma } from "@repo/db";
import crypto from "crypto";

declare global {
  namespace Express {
    interface Request {
      apiKey?: {
        id: number;
        userId: number;
        name: string;
        rateLimitRPM: number;
        rateLimitTPM: number;
        budgetLimit?: bigint | null;
        creditsUsed: bigint;
        isActive: boolean;
      };
      user?: {
        id: number;
        clerkUserId: string;
      };
    }
  }
}

export async function apiKeyGate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        error: {
          message: "Missing or invalid authorization header",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      });
      return;
    }

    const token = authHeader.slice(7).trim(); // Remove "Bearer " prefix
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Find the API key in database
    const apiKey = await prisma.platformUserApiKey.findUnique({
      where: { keyHash: tokenHash },
      include: { user: true },
    });

    if (!apiKey) {
      res.status(401).json({
        error: {
          message: "Invalid API key",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      });
      return;
    }

    if (!apiKey.isActive) {
      res.status(401).json({
        error: {
          message: "API key is inactive",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      });
      return;
    }

    // BYOK calls are paid by the user's own provider key — don't gate on credits
    const usesByok =
      typeof req.body?.extra?.byok === "string" && req.body.extra.byok.trim() !== "";

    if (!usesByok && apiKey.user.credits <= 0n) {
      res.status(402).json({
        error: {
          message: "Insufficient credits. Add credits to continue.",
          type: "insufficient_quota",
          code: "insufficient_credits",
        },
      });
      return;
    }

    if (
      !usesByok &&
      apiKey.budgetLimit !== null &&
      apiKey.creditsUsed >= apiKey.budgetLimit
    ) {
      res.status(402).json({
        error: {
          message: "API key budget limit reached",
          type: "insufficient_quota",
          code: "budget_limit_exceeded",
        },
      });
      return;
    }

    // Update last used timestamp
    await prisma.platformUserApiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    // Attach API key and user info to request
    req.apiKey = {
      id: apiKey.id,
      userId: apiKey.userId,
      name: apiKey.name,
      rateLimitRPM: apiKey.rateLimitRPM,
      rateLimitTPM: apiKey.rateLimitTPM,
      budgetLimit: apiKey.budgetLimit,
      creditsUsed: apiKey.creditsUsed,
      isActive: apiKey.isActive,
    };

    req.user = {
      id: apiKey.user.id,
      clerkUserId: apiKey.user.clerkUserId,
    };

    next();
  } catch (error) {
    console.error("[API Key Gate] Error:", error);
    res.status(500).json({
      error: {
        message: "Internal server error",
        type: "server_error",
      },
    });
  }
}
