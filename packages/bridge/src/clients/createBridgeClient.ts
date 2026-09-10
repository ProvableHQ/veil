import { bridgeActions, type BridgeActions } from './decorators/bridge.js'
import type { BridgeChainClients } from '../connections/resolve.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../registry/default.js'
import { validateBridgeRegistry } from '../registry/validate.js'
import type { BridgeEnvironment, BridgeRegistry } from '../types/protocol.js'

/**
 * Configures a protocol bridge client.
 *
 * @property environment Default route environment. Defaults to `mainnet`.
 * @property registry Optional reviewed registry override.
 * @property clients Chain capabilities keyed by registry chain id.
 * @property fetch Fetch implementation used for protocol HTTP requests.
 * @property key Stable client key. Defaults to `bridge`.
 * @property name Display name. Defaults to `Bridge Client`.
 */
export type BridgeClientConfig = {
  environment?: BridgeEnvironment | undefined
  registry?: BridgeRegistry | undefined
  clients?: BridgeChainClients | undefined
  fetch?: typeof globalThis.fetch | undefined
  key?: string | undefined
  name?: string | undefined
}

/**
 * Exposes registry-bound bridge actions without account handles or a fake base transport.
 *
 * @property key Stable client key.
 * @property name Client display name.
 * @property environment Default route environment.
 * @property registry Validated registry snapshot.
 */
export type BridgeClient = BridgeActions & {
  key: string
  name: string
  environment: BridgeEnvironment
  registry: BridgeRegistry
}

/**
 * Creates a registry-keyed multi-chain bridge coordinator.
 *
 * @param config Registry, protocol transport, and per-chain clients.
 * @returns A plain bridge client with bound discovery and transfer lifecycle actions.
 * @throws BridgeError When the registry is invalid.
 * @example
 * const bridge = createBridgeClient({ environment: 'mainnet' })
 */
export function createBridgeClient(config: BridgeClientConfig = {}): BridgeClient {
  const environment = config.environment ?? 'mainnet'
  const registry = validateBridgeRegistry(config.registry ?? DEFAULT_BRIDGE_REGISTRY)
  const fetch = config.fetch ?? globalThis.fetch
  const clients = config.clients ?? {}
  return {
    key: config.key ?? 'bridge',
    name: config.name ?? 'Bridge Client',
    environment,
    registry,
    ...bridgeActions({ environment, registry, clients, fetch }),
  }
}
