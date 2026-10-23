import { prisma } from "@repo/db";

// ─── Usage Billing ───────────────────────────────────────────
// Deducts the cost of a successful call from the user's credits and
// adds it to the API key's running total, atomically.
export async function chargeUsage(
  userId: number,
  apiKeyId: number,
  costMicros: bigint,
): Promise<void> {
  if (costMicros <= 0n) return;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { credits: { decrement: costMicros } },
    }),
    prisma.platformUserApiKey.update({
      where: { id: apiKeyId },
      data: { creditsUsed: { increment: costMicros } },
    }),
  ]);
}
