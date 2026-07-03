import { BridgeError } from '../errors/bridgeErrors.js'

/**
 * Configuration for how a source asset maps to its Aleo program for the
 * unshield deposit step. Consumers can extend the map at call time by passing
 * an override (see swap action's optional aleoAssetMap param).
 *
 * @property program Aleo program the unshield deposit transfer goes through.
 * @property decimals Display decimals of the asset; fallback for scaling the
 *   API's decimal `depositAmount` into atomic units when the order's deposit
 *   instructions do not carry `assetDecimals`.
 * @property amountWidth Integer width the program's transfer functions take
 *   the amount as: `'u64'` for credits.aleo, `'u128'` for the ARC-20 style
 *   token programs.
 * @property requiresMerkleProof Set when the underlying program requires a
 *   merkle-proof input on private/unshield transitions (usdcx_stablecoin,
 *   usad_stablecoin, etc).
 */
export type AleoAssetConfig = {
  program: string
  decimals: number
  amountWidth: 'u64' | 'u128'
  requiresMerkleProof?: boolean
}

/**
 * Maps the bridge API's chain-qualified Aleo asset codes (`GET /common/assets`,
 * chain `ALEO`) to the Aleo program handling each asset's unshield deposit.
 *
 * Keys are the asset codes the API uses in quotes and orders — `ALEO_MAINNET`,
 * `USDC_ALEO` — not bare symbols. The API adds assets without an SDK release,
 * so an unknown code is not necessarily an error: extend this map (or pass a
 * custom `aleoAssetMap`) with the new code's program, decimals, and width.
 */
export const DEFAULT_ALEO_ASSET_MAP: Readonly<Record<string, AleoAssetConfig>> = Object.freeze({
  ALEO_MAINNET: { program: 'credits.aleo', decimals: 6, amountWidth: 'u64' },
  ETH_ALEO: { program: 'token_registry.aleo', decimals: 18, amountWidth: 'u128' },
  USDC_ALEO: { program: 'token_registry.aleo', decimals: 6, amountWidth: 'u128' },
  USDT_ALEO: { program: 'token_registry.aleo', decimals: 6, amountWidth: 'u128' },
  WBTC_ALEO: { program: 'token_registry.aleo', decimals: 8, amountWidth: 'u128' },
  WSOL_ALEO: { program: 'token_registry.aleo', decimals: 9, amountWidth: 'u128' },
  USDCX_ALEO: { program: 'usdcx_stablecoin.aleo', decimals: 6, amountWidth: 'u128', requiresMerkleProof: true },
  USAD_ALEO: { program: 'usad_stablecoin.aleo', decimals: 6, amountWidth: 'u128', requiresMerkleProof: true },
})

/**
 * Resolves an Aleo asset code to its program configuration.
 *
 * Lookup is case-insensitive over the map's keys — including keys of a
 * caller-supplied map, whatever their casing. Pure and local.
 *
 * @param assetCode Chain-qualified asset code (e.g. `ALEO_MAINNET`, `WBTC_ALEO`).
 * @param map Asset map to resolve against. Defaults to
 *   {@link DEFAULT_ALEO_ASSET_MAP}; pass an extended map for assets the API
 *   added after this SDK release.
 * @returns The asset's program, decimals, width, and merkle-proof requirement.
 * @throws BridgeError When the code is not in the map.
 *
 * @example
 * const { program, decimals } = aleoAssetProgram('ALEO_MAINNET') // credits.aleo, 6
 */
export function aleoAssetProgram(
  assetCode: string,
  map: Readonly<Record<string, AleoAssetConfig>> = DEFAULT_ALEO_ASSET_MAP,
): AleoAssetConfig {
  const wanted = assetCode.toUpperCase()
  // Normalize both sides: direct hit first, then a case-insensitive scan so a
  // caller-supplied map keyed in any casing still matches.
  const config =
    map[assetCode] ??
    map[wanted] ??
    Object.entries(map).find(([key]) => key.toUpperCase() === wanted)?.[1]
  if (!config) {
    throw new BridgeError(
      `Unknown Aleo asset "${assetCode}". Use the chain-qualified code from GET /common/assets (e.g. ALEO_MAINNET), and extend DEFAULT_ALEO_ASSET_MAP or pass a custom aleoAssetMap for assets this SDK does not know yet.`,
    )
  }
  return config
}
