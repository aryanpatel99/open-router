export const MICRO_SCALE = 1_000_000;

/**
 * Converts a dollar amount (number) to micros (bigint).
 * Example: 1.50 -> 1500000n
 */
export function toMicros(dollars: number): bigint {
  return BigInt(Math.round(dollars * MICRO_SCALE));
}

/**
 * Converts a per-token dollar price to micros per 1M tokens (bigint).
 * Example: 0.0000003 -> 300000n
 */
export function toMicrosPerMillion(dollarsPerToken: number): bigint {
  return BigInt(Math.round(dollarsPerToken * MICRO_SCALE * 1_000_000));
}

/**
 * Converts a micro amount (bigint or number) back to dollars (number).
 * Example: 1500000n -> 1.50
 */
export function toDollars(micros: bigint | number): number {
  return Number(micros) / MICRO_SCALE;
}

/**
 * Formats a micro amount for display as USD.
 * Example: 1500000n -> "$1.50"
 */
export function formatCurrency(
  micros: bigint | number,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
    ...options,
  }).format(toDollars(micros));
}
