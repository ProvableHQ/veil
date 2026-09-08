import { createClient, createTransport, type Client } from '@provablehq/veil-core'
import { bridgeActions, type BridgeActions } from './decorators/bridge.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../registry/default.js'
import { validateBridgeRegistry } from '../registry/validate.js'
import type { BridgeExecutors } from '../types/evm.js'
import type { BridgeEnvironment, BridgeRegistry } from '../types/protocol.js'
import type { SolanaRpcConfig } from '../types/solana.js'
import type { XReserveHttpTransport } from '../types/xreserve.js'

/**
 * Configures a protocol bridge client.
 *
 * @property environment Routes and assets exposed by default. Defaults to `mainnet`.
 * @property registry Reviewed protocol deployment snapshot. Defaults to {@link DEFAULT_BRIDGE_REGISTRY}.
 * @property executors Optional wallet capabilities used by fund-moving protocol actions.
 * @property xReserveHttpTransport Optional fetch-compatible transport used for Circle attestation requests.
 * @property aleoPublicClient Optional Aleo public client used for on-chain reads such as Hyperlane gas quotes.
 * @property solanaRpc Optional Solana JSON-RPC endpoint used for on-chain reads such as blockhash and confirmation lookups.
 * @property key Client identifier. Defaults to `bridge`.
 * @property name Human-readable client name. Defaults to `Bridge Client`.
 */
export type BridgeClientConfig = {
  environment?: BridgeEnvironment | undefined
  registry?: BridgeRegistry | undefined
  executors?: BridgeExecutors | undefined
  xReserveHttpTransport?: XReserveHttpTransport | undefined
  aleoPublicClient?: Client | undefined
  solanaRpc?: SolanaRpcConfig | undefined
  key?: string | undefined
  name?: string | undefined
}

type BridgeClientState = {
  environment: BridgeEnvironment
  registry: BridgeRegistry
}

/**
 * Exposes protocol bridge discovery, planning, and configured execution actions.
 *
 * The client retains Veil's `extend()` composition model. Its base transport
 * is reserved for protocol executors. Discovery and planning remain pure and
 * local; execution actions require the corresponding injected capability.
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
 * Discovery and transfer planning read the configured registry without network
 * access. An injected EVM executor enables Ethereum Hyperlane quote and execution
 * actions without exposing private keys to the client. An injected Aleo wallet
 * client enables user-authorized private USDCx mints and USDCx burns.
 *
 * @param config Optional environment, registry, executors, and client identity.
 * @returns A bridge client exposing discovery, planning, and configured protocol actions.
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
    executors = {},
    xReserveHttpTransport,
    aleoPublicClient,
    solanaRpc,
    key = 'bridge',
    name = 'Bridge Client',
  } = config
  const validated = validateBridgeRegistry(registry)
  const client = createClient({ transport: localBridgeTransport(), key, name })
  return client.extend((inner) => ({
    environment,
    registry: validated,
    ...bridgeActions(inner, { environment, registry: validated, executors, xReserveHttpTransport, aleoPublicClient, solanaRpc }),
  })) as BridgeClient
}
