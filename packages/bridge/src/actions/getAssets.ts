import type { Client } from '@provablehq/veil-core'
import { unwrapEnvelope } from '../utils/unwrapEnvelope.js'
import type { BridgeAssetSummary } from '../types/bridge.js'

/** What `getAssets` resolves with: every asset the bridge knows. */
export type GetAssetsReturnType = BridgeAssetSummary[]

/**
 * Fetches the bridge's asset catalog — the source of truth for every
 * identifier the other calls take.
 *
 * Each entry carries the chain-qualified `code` (`ALEO_MAINNET`, `USDC_ETH`)
 * that `srcAsset`/`destAsset` expect, the case-sensitive `chain` identifier
 * (`ALEO`, `EVM:1`) that `srcChain`/`destChain` expect, the `decimals` that
 * bound amount precision, a `walletValidationRegex` for recipient addresses,
 * and `supportedProviders` naming which providers can route the asset. Call
 * this instead of hardcoding codes — the catalog changes without an SDK
 * release. Hits the network; read-only.
 *
 * @param client A client whose transport is `httpBridge`.
 * @returns Every asset the bridge knows.
 * @throws BridgeEnvelopeError When the response envelope has no `data`.
 *
 * @example
 * const assets = await getAssets(client)
 * const aleoSide = assets.filter((a) => a.chain === 'ALEO')
 * const usdcOnEth = assets.find((a) => a.symbol === 'USDC' && a.chain === 'EVM:1')
 */
export async function getAssets(client: Client): Promise<GetAssetsReturnType> {
  const response = await client.request({ method: 'getBridgeAssets' })
  return unwrapEnvelope<BridgeAssetSummary[]>(response)
}
