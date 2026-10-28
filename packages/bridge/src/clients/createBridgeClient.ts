import { bridgeActions, type BridgeActions, type HasPrivateMintStore } from './decorators/bridge.js'
import type { BridgeChainClients } from '../connections/resolve.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../registry/default.js'
import { validateBridgeRegistry } from '../registry/validate.js'
import type { BridgeEnvironment, BridgeRegistry } from '../types/protocol.js'
import type { CircleBridgeConfig } from './decorators/bridge.js'

/**
 * Configures the chains, wallets, providers, and route catalog available to a bridge client.
 *
 * @property environment Default route environment. Defaults to `mainnet`.
 * @property registry Optional replacement catalog of supported assets, routes, and reviewed provider deployments. Defaults to the package catalog.
 * @property clients Network and optional wallet access keyed by the matching chain identifier in the catalog.
 * @property fetch Optional Fetch API implementation used for provider status requests. Defaults to `globalThis.fetch`.
 * @property key Stable client key. Defaults to `bridge`.
 * @property name Display name. Defaults to `Bridge Client`.
 * @property circle Circle-specific client configuration, such as the persistence for locally derived private USDCx mint identities. Without a store, every private mint quote must name a nonce source under `circle`.
 */
export type BridgeClientConfig = {
  environment?: BridgeEnvironment | undefined
  registry?: BridgeRegistry | undefined
  clients?: BridgeChainClients | undefined
  fetch?: typeof globalThis.fetch | undefined
  key?: string | undefined
  name?: string | undefined
  circle?: CircleBridgeConfig | undefined
}

/**
 * Exposes the actions for discovering, pricing, submitting, following, and recovering cross-chain transfers.
 *
 * @property key Stable client key.
 * @property name Client display name.
 * @property environment Default route environment.
 * @property registry Validated catalog of supported assets, routes, and provider deployments.
 */
export type BridgeClient<HasStore extends boolean = false> = BridgeActions<HasStore> & {
  key: string
  name: string
  environment: BridgeEnvironment
  registry: BridgeRegistry
}

/**
 * Creates a client for discovering, pricing, submitting, following, and recovering cross-chain transfers.
 *
 * Construction validates the configured catalog and stores the supplied network
 * and wallet clients. It does not contact a chain or provider, request a
 * signature, submit a transaction, move funds, or manage application storage.
 *
 * @param config Networks, wallets, provider HTTP access, and optional replacement route catalog.
 * @returns Bridge actions bound to the configured chains, wallets, providers, and environment. When `config.circle.privateMintIdentities` is set, private mint quotes need no call-level nonce source.
 * @throws BridgeError When the route catalog contains duplicate, missing, or incompatible references.
 * @example
 * const bridge = createBridgeClient({ environment: 'mainnet' })
 */
export function createBridgeClient<Config extends BridgeClientConfig = Record<never, never>>(
  config: Config = {} as Config,
): BridgeClient<HasPrivateMintStore<Config>> {
  // Select all defaults before validation so every bound action observes one
  // immutable configuration decision for the lifetime of this client.
  const environment = config.environment ?? 'mainnet'
  // Fail catalog topology and reviewed-metadata errors during construction,
  // before any later action can read a chain or involve a wallet.
  const registry = validateBridgeRegistry(config.registry ?? DEFAULT_BRIDGE_REGISTRY)
  const fetch = config.fetch ?? globalThis.fetch
  const clients = config.clients ?? {}
  return {
    key: config.key ?? 'bridge',
    name: config.name ?? 'Bridge Client',
    environment,
    registry,
    // The store decision was made on `config`, so the bound actions carry its answer.
    ...(bridgeActions({ registry, clients, fetch, circle: config.circle }) as BridgeActions<HasPrivateMintStore<Config>>),
  }
}
