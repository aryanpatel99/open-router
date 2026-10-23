import { prisma } from "@repo/db";
import type { Run } from "./types.ts";

export async function saveRun(run: Run): Promise<void> {
  await prisma.telemetryRun.upsert({
    where: { id: run.id },
    create: {
      id: run.id,
      status: run.status,
      operation: run.operation,
      model: run.model,
      provider: run.provider,
      startedAt: new Date(run.startedAt),
      completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
      duration: run.duration,
      promptTokens: run.promptTokens,
      completionTokens: run.completionTokens,
      totalTokens: run.totalTokens,
      thoughtsTokens: run.thoughtsTokens,
      cacheReadTokens: run.cacheReadTokens,
      costMicros: run.costMicros !== undefined ? BigInt(Math.round(run.costMicros)) : undefined,
      userId: run.userId,
      apiKeyId: run.apiKeyId,
      steps: run.steps as object[],
      input: run.input as object,
      error: run.error,
    },
    update: {
      status: run.status,
      provider: run.provider,
      completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
      duration: run.duration,
      promptTokens: run.promptTokens,
      completionTokens: run.completionTokens,
      totalTokens: run.totalTokens,
      thoughtsTokens: run.thoughtsTokens,
      cacheReadTokens: run.cacheReadTokens,
      costMicros: run.costMicros !== undefined ? BigInt(Math.round(run.costMicros)) : undefined,
      steps: run.steps as object[],
      error: run.error,
    },
  });
}
