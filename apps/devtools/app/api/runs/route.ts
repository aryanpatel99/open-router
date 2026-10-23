import { NextResponse } from "next/server";
import { prisma } from "@repo/db";
import type { TelemetryData, Run } from "@/lib/telemetry";

const MAX_RUNS = 200;

export async function GET() {
  try {
    const dbRuns = await prisma.telemetryRun.findMany({
      orderBy: { startedAt: "desc" },
      take: MAX_RUNS,
    });

    const runs: Run[] = dbRuns.map((r) => ({
      id: r.id,
      status: r.status as Run["status"],
      operation: r.operation as "chat",
      model: r.model,
      provider: r.provider ?? undefined,
      startedAt: r.startedAt.getTime(),
      completedAt: r.completedAt?.getTime(),
      duration: r.duration ?? undefined,
      promptTokens: r.promptTokens ?? undefined,
      completionTokens: r.completionTokens ?? undefined,
      totalTokens: r.totalTokens ?? undefined,
      thoughtsTokens: r.thoughtsTokens ?? undefined,
      cacheReadTokens: r.cacheReadTokens ?? undefined,
      // BigInt → number is safe for micros values
      costMicros: r.costMicros !== null ? Number(r.costMicros) : undefined,
      userId: r.userId ?? undefined,
      apiKeyId: r.apiKeyId ?? undefined,
      steps: r.steps as unknown as Run["steps"],
      input: r.input as unknown as Run["input"],
      error: r.error ?? undefined,
    }));

    return NextResponse.json({ runs } satisfies TelemetryData);
  } catch {
    return NextResponse.json({ runs: [] } satisfies TelemetryData);
  }
}

export async function DELETE() {
  try {
    await prisma.telemetryRun.deleteMany();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
