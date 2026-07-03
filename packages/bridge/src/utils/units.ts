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
