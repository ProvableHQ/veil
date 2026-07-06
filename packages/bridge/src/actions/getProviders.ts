import type { Client } from '@veil/core'
import { unwrapEnvelope } from '../utils/unwrapEnvelope.js'
import type { ProviderSummary } from '../types/bridge.js'

/** What `getProviders` resolves with: every registered provider. */
export type GetProvidersReturnType = ProviderSummary[]

/**
 * Fetches the provider registry — every provider the service knows, bridge
 * and fiat-ramp alike.
 *
 * Filter on `capabilities` including `'BRIDGE'` for the swap providers;
 * `BUY`/`SELL` entries are on-ramps. Registry presence does not guarantee a
 * provider is currently quoting (enablement is environment-specific) — the
 * per-asset `supportedProviders` from `getAssets`, and ultimately a live
 * `getQuotes`, are the authoritative signals. Hits the network; read-only.
 *
 * @param client A client whose transport is `httpBridge`.
 * @returns Every registered provider.
 * @throws BridgeEnvelopeError When the response envelope has no `data`.
 *
 * @example
 * const providers = await getProviders(client)
 * const bridges = providers.filter((p) => p.capabilities.includes('BRIDGE'))
 */
export async function getProviders(client: Client): Promise<GetProvidersReturnType> {
  const response = await client.request({ method: 'getBridgeProviders' })
  return unwrapEnvelope<ProviderSummary[]>(response)
}
