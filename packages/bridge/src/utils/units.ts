import { BridgeError } from '../errors/bridgeErrors.js'

/**
 * Converts a decimal amount string into the asset's atomic units.
 *
 * Protocol inputs use display decimals (`"0.5"` ALEO), while onchain calls
 * use atomic integers (`500000n` microcredits). String arithmetic keeps the
 * conversion exact without floating-point rounding. Pure and local.
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

/**
 * Formats a non-negative atomic amount as an exact decimal display value.
 *
 * Pure string arithmetic removes trailing fractional zeroes without using
 * floating point.
 *
 * @param amount Atomic amount to format; MUST be non-negative.
 * @param decimals Number of fractional decimal places used by the asset.
 * @returns Canonical decimal text with no redundant trailing zeroes.
 * @throws BridgeError When the amount or decimal width is negative.
 *
 * @example
 * formatDecimalAmount(2_000_001n, 6) // '2.000001'
 */
export function formatDecimalAmount(amount: bigint, decimals: number): string {
  if (amount < 0n) throw new BridgeError('Atomic amount must be non-negative')
  if (!Number.isSafeInteger(decimals) || decimals < 0) {
    throw new BridgeError('Asset decimals must be a non-negative safe integer')
  }
  if (decimals === 0) return amount.toString()
  const digits = amount.toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, -decimals)
  const fraction = digits.slice(-decimals).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}
