/**
 * Fixed-point currency helpers scaled to 4 decimal places (DECIMAL(18,4): 1 HKD = 10,000 units),
 * avoiding IEEE-754 float/real drift observed in legacy SQL Server tables.
 */

export const SCALE_4 = 10_000;

export function toScaled4(amount: number): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Invalid monetary amount: ${amount}`);
  }
  return Math.round(amount * SCALE_4);
}

export function fromScaled4(scaled: number): number {
  return scaled / SCALE_4;
}

export function roundToCents(amount: number): number {
  const scaledCents = Math.round((amount + Math.sign(amount) * 1e-11) * 100);
  return scaledCents / 100;
}

export function toCents(amount: number): number {
  return Math.round((amount + Math.sign(amount) * 1e-11) * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function formatHkd(amount: number, decimals = 2): string {
  return `HK$${amount.toLocaleString("en-HK", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
