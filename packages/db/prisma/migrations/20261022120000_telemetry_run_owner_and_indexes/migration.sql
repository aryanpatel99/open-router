-- AlterTable
ALTER TABLE "TelemetryRun" ADD COLUMN     "apiKeyId" INTEGER,
ADD COLUMN     "userId" INTEGER;

-- CreateIndex
CREATE INDEX "TelemetryRun_startedAt_idx" ON "TelemetryRun"("startedAt");

-- CreateIndex
CREATE INDEX "TelemetryRun_userId_startedAt_idx" ON "TelemetryRun"("userId", "startedAt");
