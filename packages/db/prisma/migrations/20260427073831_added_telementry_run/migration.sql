-- CreateTable
CREATE TABLE "TelemetryRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provider" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "duration" INTEGER,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "thoughtsTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "costMicros" BIGINT,
    "steps" JSONB NOT NULL,
    "input" JSONB NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryRun_pkey" PRIMARY KEY ("id")
);
