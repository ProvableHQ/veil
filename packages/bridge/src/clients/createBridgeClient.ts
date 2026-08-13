import { createClient, createTransport, type Client } from '@provablehq/veil-core'
import { bridgeActions, type BridgeActions } from './decorators/bridge.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../registry/default.js'
import { validateBridgeRegistry } from '../registry/validate.js'
import type { BridgeEnvironment, BridgeRegistry } from '../types/protocol.js'

/**
 * Configures a protocol bridge client.
 *
 * @property environment Routes and assets exposed by default. Defaults to `mainnet`.
 * @property registry Reviewed protocol deployment snapshot. Defaults to {@link DEFAULT_BRIDGE_REGISTRY}.
 * @property key Client identifier. Defaults to `bridge`.
 * @property name Human-readable client name. Defaults to `Bridge Client`.
 */
export type BridgeClientConfig = {
  environment?: BridgeEnvironment | undefined
  registry?: BridgeRegistry | undefined
  key?: string | undefined
  name?: string | undefined
}

type BridgeClientState = {
  environment: BridgeEnvironment
  registry: BridgeRegistry
}

/**
 * Exposes protocol bridge discovery and local transfer planning.
 *
 * The client retains Veil's `extend()` composition model. Its base transport
 * is reserved for later protocol executors; the current public actions are
 * pure and local.
 */
export type BridgeClient = Client<BridgeActions & BridgeClientState>

function localBridgeTransport() {
  return createTransport({
    key: 'protocolBridge',
    name: 'Protocol Bridge Transport',
    type: 'protocolBridge',
    request: async ({ method }) => {
      throw new Error(`Protocol bridge method is not implemented: ${method}`)
    },
  })
}

/**
 * Creates a protocol-oriented bridge client for xReserve and Hyperlane.
 *
 * The current foundation is pure and local: discovery and transfer planning
 * read the configured registry without contacting a protocol or moving funds.
 * Protocol executors are added in subsequent implementation phases.
 *
 * @param config Optional environment, registry, and client identity.
 * @returns A bridge client exposing registry discovery and `prepareTransfer`.
 * @throws BridgeError When the supplied registry has invalid references.
 *
 * @example
 * const bridge = createBridgeClient({ environment: 'testnet' })
 * const routes = bridge.getRoutes({ protocol: 'xreserve' })
 */
export function createBridgeClient(config: BridgeClientConfig = {}): BridgeClient {
  const {
    environment = 'mainnet',
    registry = DEFAULT_BRIDGE_REGISTRY,
    key = 'bridge',
    name = 'Bridge Client',
  } = config
  const validated = validateBridgeRegistry(registry)
  const client = createClient({ transport: localBridgeTransport(), key, name })
  return client.extend((inner) => ({
    environment,
    registry: validated,
    ...bridgeActions(inner, { environment, registry: validated }),
  })) as BridgeClient
}
