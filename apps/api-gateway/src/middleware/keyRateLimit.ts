import type { Request, Response, NextFunction } from "express";

/**
 * Per-API-key requests-per-minute limiter (fixed window, in memory).
 * Uses the key's `rateLimitRPM`; must run after `apiKeyGate`.
 * In-memory state is per process — move to Redis when scaling out.
 */
const WINDOW_MS = 60 * 1000;
const windows = new Map<number, { count: number; resetTime: number }>();

export function keyRateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = req.apiKey;
  if (!key || key.rateLimitRPM <= 0) {
    next();
    return;
  }

  const now = Date.now();
  const record = windows.get(key.id);

  if (!record || now > record.resetTime) {
    windows.set(key.id, { count: 1, resetTime: now + WINDOW_MS });
    next();
    return;
  }

  if (record.count >= key.rateLimitRPM) {
    res.setHeader("Retry-After", Math.ceil((record.resetTime - now) / 1000));
    res.status(429).json({
      error: {
        message: `Rate limit exceeded: ${key.rateLimitRPM} requests per minute`,
        type: "rate_limit_error",
        code: "rate_limit_exceeded",
      },
    });
    return;
  }

  record.count++;
  next();
}
