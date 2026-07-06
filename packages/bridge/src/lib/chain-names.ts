/**
 * STOPGAP — chain display names maintained client-side.
 *
 * The API's chains table has a display_name column, but no endpoint exposes
 * it yet (proposed upstream as GET /common/chains). Until that ships and
 * this SDK adopts it, the names live here. Chains churn far slower than
 * assets (ten today), so the drift risk is small — but delete this file in
 * favor of the endpoint once it exists.
 */

/**
 * Human-readable names for the chain identifiers the bridge used at the time
 * of writing. Keys are the API's case-sensitive chain ids.
 */
export const KNOWN_CHAIN_NAMES: Readonly<Record<string, string>> = Object.freeze({
  ALEO: 'Aleo',
  BITCOIN: 'Bitcoin',
  'EVM:1': 'Ethereum',
  'EVM:42161': 'Arbitrum',
  'EVM:56': 'BNB Smart Chain',
  'EVM:8453': 'Base',
  MONERO: 'Monero',
  SOLANA: 'Solana',
  TRON: 'Tron',
  ZCASH: 'Zcash',
})

/**
 * Resolves a chain identifier to a human-readable name.
 *
 * Falls back to the identifier itself for chains this SDK does not know —
 * an unknown chain is not an error (the API adds chains without an SDK
 * release), just not yet nameable. Pure and local.
 *
 * @param chain The API's chain identifier (`ALEO`, `SOLANA`, `EVM:8453`).
 * @returns The display name (`'Base'` for `EVM:8453`), or `chain` verbatim
 *   when unknown.
 *
 * @example
 * chainDisplayName('EVM:8453') // 'Base'
 * chainDisplayName('EVM:999')  // 'EVM:999' (unknown → identifier)
 */
export function chainDisplayName(chain: string): string {
  return KNOWN_CHAIN_NAMES[chain] ?? chain
}

/**
 * Resolves a chain reference — identifier or display name — to the API's
 * identifier.
 *
 * The inverse of {@link chainDisplayName}: `'Solana'` → `'SOLANA'`, `'Base'`
 * → `'EVM:8453'`. Matching is case-insensitive on both forms; anything
 * unrecognized passes through verbatim (the API is the final validator, and
 * a chain this SDK does not know may still be valid there). Pure and local.
 *
 * @param chainOrName A chain identifier (`'EVM:1'`) or display name
 *   (`'Ethereum'`), any casing.
 * @returns The API's case-sensitive chain identifier, or the input verbatim
 *   when unrecognized.
 *
 * @example
 * resolveChainId('Solana')   // 'SOLANA'
 * resolveChainId('evm:8453') // 'EVM:8453'
 * resolveChainId('NEWCHAIN') // 'NEWCHAIN' (unknown → pass through)
 */
export function resolveChainId(chainOrName: string): string {
  const wanted = chainOrName.toLowerCase()
  for (const [id, name] of Object.entries(KNOWN_CHAIN_NAMES)) {
    if (id.toLowerCase() === wanted || name.toLowerCase() === wanted) return id
  }
  return chainOrName
}
