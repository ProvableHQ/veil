import { BridgeError } from '../errors/bridgeErrors.js'

/**
 * Converts a decimal amount string into the asset's atomic units.
 *
 * The bridge API quotes and instructs in display decimals (`"0.5"` ALEO),
 * while Aleo program transfers take atomic integers (`500000n` microcredits).
 * String-based, so it is exact — no float rounding. Pure and local.
 *
 * @param amount Decimal amount as a string (e.g. `"0.5"`, `"100"`).
 * @param decimals The asset's display decimals (e.g. 6 for ALEO/USDC, 18 for ETH).
 * @returns The atomic amount as a bigint.
 * @throws BridgeError When the string is not a plain decimal number, or has
 *   more fractional digits than the asset supports (that precision cannot be
 *   represented on chain).
 *
 * @example
 * parseDecimalAmount('0.5', 6)   // 500000n
 * parseDecimalAmount('100', 6)   // 100000000n
 */
/**
 * Compares two non-negative decimal amount strings exactly.
 *
 * `Number()` comparison loses precision past ~15 significant digits — enough
 * to mis-rank quotes on 18-decimal assets. This compares digit strings
 * directly, so it is exact at any precision. Pure and local; returns 0 for
 * malformed inputs rather than throwing (callers rank, they don't validate).
 *
 * @param a First decimal string (e.g. `"1.000000000000000002"`).
 * @param b Second decimal string.
 * @returns Negative when a < b, positive when a > b, 0 when equal.
 */
export function compareDecimal(a: string, b: string): number {
  const parse = (s: string) => /^(\d+)(?:\.(\d*))?$/.exec(s.trim())
  const ma = parse(a)
  const mb = parse(b)
  if (!ma || !mb) return 0
  const fracLen = Math.max(ma[2]?.length ?? 0, mb[2]?.length ?? 0)
  const ia = BigInt(ma[1]! + (ma[2] ?? '').padEnd(fracLen, '0'))
  const ib = BigInt(mb[1]! + (mb[2] ?? '').padEnd(fracLen, '0'))
  return ia < ib ? -1 : ia > ib ? 1 : 0
}

export function parseDecimalAmount(amount: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim())
  if (!match) {
    throw new BridgeError(`Invalid decimal amount "${amount}"`)
  }
  const whole = match[1]!
  const frac = match[2] ?? ''
  if (frac.length > decimals) {
    throw new BridgeError(
      `Amount "${amount}" has ${frac.length} fractional digits but the asset supports ${decimals}`,
    )
  }
  return BigInt(whole + frac.padEnd(decimals, '0'))
}
