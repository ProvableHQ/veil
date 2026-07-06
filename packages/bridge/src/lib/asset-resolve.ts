import { BridgeError } from '../errors/bridgeErrors.js'
import type { BridgeAssetSummary } from '../types/bridge.js'

/**
 * Whether an asset reference is already a chain-qualified code.
 *
 * Every code in the catalog contains an underscore (`ALEO_MAINNET`,
 * `USDC_ETH`); symbols never do (`USDC`, `WBTC`, `USDCx`). Pure and local.
 *
 * @param assetRef An asset code or symbol as passed by a caller.
 * @returns True when the reference can go to the API as-is.
 */
export function isAssetCode(assetRef: string): boolean {
  return assetRef.includes('_')
}

/**
 * Resolves an asset symbol to its chain-qualified code on a given chain.
 *
 * Symbols are only unambiguous per chain (`USDC` exists on five), so the
 * chain identifier scopes the lookup; matching is case-insensitive. A
 * reference that is already a code (contains `_`) passes through verbatim —
 * the API stays the final validator. Pure and local; the caller supplies the
 * catalog (one `getAssets` fetch covers every resolution in a call).
 *
 * @param assets The asset catalog, from `getAssets`.
 * @param assetRef A chain-qualified code (returned verbatim) or a symbol.
 * @param chain The API chain identifier scoping a symbol lookup (already
 *   resolved — pass through `resolveChainId` first).
 * @returns The chain-qualified asset code.
 * @throws BridgeError When a symbol matches nothing on the chain (the error
 *   lists the chain's symbols) or, defensively, more than one entry.
 *
 * @example
 * resolveAssetCode(assets, 'USDC', 'EVM:1')      // 'USDC_ETH'
 * resolveAssetCode(assets, 'USDC_ETH', 'EVM:1')  // 'USDC_ETH' (verbatim)
 */
export function resolveAssetCode(
  assets: BridgeAssetSummary[],
  assetRef: string,
  chain: string,
): string {
  if (isAssetCode(assetRef)) return assetRef

  const wanted = assetRef.toLowerCase()
  const matches = assets.filter((a) => a.chain === chain && a.symbol.toLowerCase() === wanted)
  if (matches.length === 1) return matches[0]!.code
  if (matches.length === 0) {
    const symbols = [...new Set(assets.filter((a) => a.chain === chain).map((a) => a.symbol))]
    throw new BridgeError(
      `No asset with symbol "${assetRef}" on chain ${chain}. Symbols there: ${symbols.join(', ') || '(none)'}. Pass a chain-qualified code from getAssets() to bypass symbol resolution.`,
    )
  }
  throw new BridgeError(
    `Symbol "${assetRef}" is ambiguous on chain ${chain}: ${matches.map((a) => a.code).join(', ')}. Pass the chain-qualified code.`,
  )
}
