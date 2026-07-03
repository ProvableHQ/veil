const MICROCREDITS_PER_CREDIT = 1_000_000n

/**
 * Converts credits to microcredits (1 credit = 1,000,000 microcredits).
 *
 * Fee and amount parameters across Veil take microcredits; use this to
 * accept human-friendly credit amounts. Pure and local.
 *
 * @param credits Amount in credits. A `number` is rounded to the nearest
 *   microcredit, so fractional amounts like `1.5` are safe; pass `bigint`
 *   for whole-credit amounts beyond `Number.MAX_SAFE_INTEGER`.
 * @returns Amount in microcredits (u64).
 *
 * @example
 * creditsToMicrocredits(1.5) // 1_500_000n
 */
export function creditsToMicrocredits(credits: bigint | number): bigint {
  if (typeof credits === 'number') {
    return BigInt(Math.round(credits * Number(MICROCREDITS_PER_CREDIT)))
  }
  return credits * MICROCREDITS_PER_CREDIT
}

/**
 * Converts microcredits to credits (1,000,000 microcredits = 1 credit).
 * Pure and local.
 *
 * The result is a floating-point `number` — use it for display. Keep
 * amounts in microcredits for fee arithmetic to avoid rounding drift.
 *
 * @param microcredits Amount in microcredits (u64).
 * @returns Amount in credits, possibly fractional.
 *
 * @example
 * microcreditsToCredits(1_500_000n) // 1.5
 */
export function microcreditsToCredits(microcredits: bigint): number {
  return Number(microcredits) / Number(MICROCREDITS_PER_CREDIT)
}
