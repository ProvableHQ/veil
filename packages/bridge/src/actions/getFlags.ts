import type { Client } from '@veil/core'
import { unwrapEnvelope } from '../utils/unwrapEnvelope.js'
import type { BridgeFlagsDto } from '../types/bridge.js'

export type GetFlagsReturnType = BridgeFlagsDto

/**
 * Fetches the bridge's server-side feature flags.
 *
 * Call this before building a swap UI or route plan: flags gate provider
 * capabilities that change without an SDK release (e.g. whether NEAR-routed
 * pairs can land privately on Aleo). Hits the network; read-only.
 *
 * @param client A client whose transport is `httpBridge`.
 * @returns The current {@link BridgeFlagsDto} flag values.
 * @throws BridgeEnvelopeError When the response envelope has no `data`.
 *
 * @example
 * const flags = await getFlags(bridgeClient)
 * if (!flags.near_supports_pub_priv_swaps) hidePrivateNearRoutes()
 */
export async function getFlags(client: Client): Promise<GetFlagsReturnType> {
  const response = await client.request({ method: 'getBridgeFlags' })
  return unwrapEnvelope<BridgeFlagsDto>(response)
}
