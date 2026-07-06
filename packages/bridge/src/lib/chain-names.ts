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
