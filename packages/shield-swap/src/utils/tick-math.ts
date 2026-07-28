// Tick alignment helpers. The Q128.128 price math lives in q128.ts; this
// module keeps only the spacing arithmetic that survived the Q64 → Q128
// migration unchanged.

export { MIN_TICK, MAX_TICK } from './q128.js'

/**
 * Rounds a tick down to the pool's tick spacing.
 *
 * `mint` requires `tick % spacing == 0` for both bounds — the contract
 * rejects unaligned ticks. Rounds toward negative infinity, matching the
 * usable-tick convention.
 *
 * @param tick The desired tick.
 * @param spacing The pool's tick spacing (from `fee_to_tick_spacing`).
 * @returns The nearest aligned tick at or below `tick`.
 *
 * @example
 * roundTickToSpacing(-95, 60) // -120
 */
export function roundTickToSpacing(tick: number, spacing: number): number {
  return Math.floor(tick / spacing) * spacing
}
