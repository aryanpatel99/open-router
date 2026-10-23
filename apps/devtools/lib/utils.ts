import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDuration(ms?: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatCost(micros?: number): string {
  if (micros === undefined || micros === null) return "—";
  const usd = micros / 1_000_000;
  if (usd === 0) return "$0.00";
  if (usd < 0.000001) return `<$0.000001`;
  return `$${usd.toFixed(6)}`;
}
