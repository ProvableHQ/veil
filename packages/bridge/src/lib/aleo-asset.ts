import { BridgeError } from '../errors/bridgeErrors.js'

/**
 * Configuration for how a source asset maps to its Aleo program for the
 * unshield deposit step. Consumers can extend the map at call time by passing
 * an override (see swap action's optional aleoAssetMap param).
 *
 * @property program Aleo program the unshield deposit transfer goes through.
 * @property decimals Display decimals of the asset; scales the API's decimal
 *   `depositAmount` into the atomic amount the program transfer expects.
 * @property requiresMerkleProof Set when the underlying program requires a
 *   merkle-proof input on private/unshield transitions (usdcx_stablecoin,
 *   usad_stablecoin, etc).
 */
export type AleoAssetConfig = {
  program: string
  decimals: number
  requiresMerkleProof?: boolean
}

/**
 * Maps the bridge API's chain-qualified Aleo asset codes (`GET /common/assets`,
 * chain `ALEO`) to the Aleo program handling each asset's unshield deposit.
 *
 * Keys are the asset codes the API uses in quotes and orders — `ALEO_MAINNET`,
 * `USDC_ALEO` — not bare symbols. The API adds assets without an SDK release,
 * so an unknown code is not necessarily an error: extend this map (or pass a
 * custom `aleoAssetMap`) with the new code's program and decimals.
 */
export const DEFAULT_ALEO_ASSET_MAP: Readonly<Record<string, AleoAssetConfig>> = Object.freeze({
  ALEO_MAINNET: { program: 'credits.aleo', decimals: 6 },
  ETH_ALEO: { program: 'token_registry.aleo', decimals: 18 },
  USDC_ALEO: { program: 'token_registry.aleo', decimals: 6 },
  USDT_ALEO: { program: 'token_registry.aleo', decimals: 6 },
  WBTC_ALEO: { program: 'token_registry.aleo', decimals: 8 },
  WSOL_ALEO: { program: 'token_registry.aleo', decimals: 9 },
  USDCX_ALEO: { program: 'usdcx_stablecoin.aleo', decimals: 6, requiresMerkleProof: true },
  USAD_ALEO: { program: 'usad_stablecoin.aleo', decimals: 6, requiresMerkleProof: true },
})

/**
 * Resolves an Aleo asset code to its program configuration.
 *
 * Lookup is case-insensitive over the map's keys. Pure and local.
 *
 * @param assetCode Chain-qualified asset code (e.g. `ALEO_MAINNET`, `WBTC_ALEO`).
 * @param map Asset map to resolve against. Defaults to
 *   {@link DEFAULT_ALEO_ASSET_MAP}; pass an extended map for assets the API
 *   added after this SDK release.
 * @returns The asset's program, decimals, and merkle-proof requirement.
 * @throws BridgeError When the code is not in the map.
 *
 * @example
 * const { program, decimals } = aleoAssetProgram('ALEO_MAINNET') // credits.aleo, 6
 */
export function aleoAssetProgram(
  assetCode: string,
  map: Readonly<Record<string, AleoAssetConfig>> = DEFAULT_ALEO_ASSET_MAP,
): AleoAssetConfig {
  const config = map[assetCode.toUpperCase()]
  if (!config) {
    throw new BridgeError(
      `Unknown Aleo asset "${assetCode}". Use the chain-qualified code from GET /common/assets (e.g. ALEO_MAINNET), and extend DEFAULT_ALEO_ASSET_MAP or pass a custom aleoAssetMap for assets this SDK does not know yet.`,
    )
  }
  return config
}
