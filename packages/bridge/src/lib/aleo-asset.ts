import { BridgeError } from '../errors/bridgeErrors.js'

/**
 * Configuration for how a source-asset symbol maps to its Aleo program for the
 * unshield deposit step. Consumers can extend the map at call time by passing
 * an override (see swap action's optional aleoAssetMap param).
 */
export type AleoAssetConfig = {
  program: string
  /**
   * @property requiresMerkleProof Set when the underlying program requires a merkle-proof input on
   * private/unshield transitions (usdcx_stablecoin, usad_stablecoin, etc).
   */
  requiresMerkleProof?: boolean
}

export const DEFAULT_ALEO_ASSET_MAP: Readonly<Record<string, AleoAssetConfig>> = Object.freeze({
  ALEO: { program: 'credits.aleo' },
  WBTC: { program: 'token_registry.aleo' },
  WETH: { program: 'token_registry.aleo' },
  WUSDC: { program: 'token_registry.aleo' },
  WSOL: { program: 'token_registry.aleo' },
  USDCX: { program: 'usdcx_stablecoin.aleo', requiresMerkleProof: true },
  USAD: { program: 'usad_stablecoin.aleo', requiresMerkleProof: true },
})

export function aleoAssetProgram(
  symbol: string,
  map: Readonly<Record<string, AleoAssetConfig>> = DEFAULT_ALEO_ASSET_MAP,
): AleoAssetConfig {
  const config = map[symbol.toUpperCase()]
  if (!config) {
    throw new BridgeError(
      `Unknown Aleo asset "${symbol}". Extend DEFAULT_ALEO_ASSET_MAP or pass a custom aleoAssetMap.`,
    )
  }
  return config
}
