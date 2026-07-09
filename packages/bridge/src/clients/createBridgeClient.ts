import { createClient, type ClientConfig, type Client, type WalletClient } from '@provablehq/veil-core'
import { bridgeActions, type BridgeActions } from './decorators/bridge.js'

/**
 * Configuration for {@link createBridgeClient}.
 *
 * @property transport The bridge transport, from `httpBridge(baseUrl)`.
 * @property wallet Optional `@provablehq/veil-core` WalletClient used by the `swap`
 *   action to sign the Aleo deposit. Set it here (viem-style account
 *   configuration) so `bridge.swap()` needs only the route; omit it for a
 *   quote/track-only client, or when supplying `wallet` per swap call.
 * @property key Client key. Defaults to `'bridge'`.
 * @property name Client name. Defaults to `'Bridge Client'`.
 */
export type BridgeClientConfig = Omit<ClientConfig, 'account' | 'key' | 'name' | 'proving'> & {
  key?: string | undefined
  name?: string | undefined
  wallet?: WalletClient | undefined
}

export type BridgeClient = Client & BridgeActions

/**
 * Creates a client for Provable's cross-chain bridge service, with every
 * bridge action bound (`getFlags`, `getQuotes`, `createOrder`, `getOrder`,
 * `getOrderAudit`, `waitForOrder`, `swap`).
 *
 * @param config Transport (required), optional signing wallet for `swap`,
 *   and client identity overrides.
 * @returns A {@link BridgeClient} — a `@provablehq/veil-core` client extended with
 *   {@link BridgeActions}.
 *
 * @example
 * const bridge = createBridgeClient({
 *   transport: httpBridge('https://wallet.api.provable.com'),
 *   wallet: walletClient, // enables bridge.swap() without per-call wiring
 * })
 */
export function createBridgeClient(config: BridgeClientConfig): BridgeClient {
  const { key = 'bridge', name = 'Bridge Client', wallet, ...rest } = config
  const client = createClient({ ...rest, key, name })
  return client.extend((c) => bridgeActions(c, { wallet })) as BridgeClient
}
