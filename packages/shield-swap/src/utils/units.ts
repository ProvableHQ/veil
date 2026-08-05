/**
 * Converts a decimal amount to raw base units.
 *
 * Everything the AMM and this SDK take is raw base units; the DEX API reports
 * some amounts as decimal strings, and people type decimals. Parsing is done on
 * the string rather than through `Number`, because a double cannot hold 18
 * significant decimals — `parseUnits('1.030419082712717843', 18)` through a
 * float silently becomes a different amount.
 *
 * Named after viem's helper of the same purpose, so the conversion reads the same
 * as it does on an EVM chain. Pure and local.
 *
 * @param amount Decimal string (`'1.5'`) or integer string. A leading `-` is
 *   rejected: amounts in this SDK are unsigned.
 * @param decimals The token's decimals, from the registry.
 * @returns The amount in base units.
 * @throws When the string is not a non-negative decimal, or carries more
 *   fractional digits than the token can represent — silently truncating would
 *   move money the caller did not intend.
 *
 * @example
 * parseUnits('1.5', 6) // 1500000n
 * parseUnits('1.030419082712717843', 18) // 1030419082712717843n
 */
export function parseUnits(amount: string, decimals: number): bigint {
  const trimmed = amount.trim()
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    throw new Error(`"${amount}" is not a non-negative decimal amount`)
  }
  const [whole = '', fraction = ''] = trimmed.split('.')
  if (fraction.length > decimals) {
    throw new Error(
      `"${amount}" has ${fraction.length} decimal places but this token has ${decimals} — ` +
        'round it yourself rather than letting a conversion drop digits.',
    )
  }
  return BigInt((whole || '0') + fraction.padEnd(decimals, '0'))
}

/**
 * Renders raw base units as a decimal string.
 *
 * The inverse of {@link parseUnits}, and the only form that should reach a person:
 * raw integers misstate balances by orders of magnitude. Trailing fractional
 * zeros are dropped, so `formatUnits(1500000n, 6)` is `'1.5'` rather than
 * `'1.500000'`. Pure and local.
 *
 * @param amount Raw base units.
 * @param decimals The token's decimals.
 * @returns The decimal string, without a symbol.
 *
 * @example
 * formatUnits(1500000n, 6) // '1.5'
 * formatUnits(1000000n, 6) // '1'
 */
export function formatUnits(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString()
  const digits = amount.toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, -decimals)
  const fraction = digits.slice(-decimals).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}
