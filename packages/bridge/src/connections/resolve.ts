import { BridgeError } from '../errors/bridgeErrors.js'
import type { BridgeRegistry } from '../types/protocol.js'
import type { AleoConnection, AleoPublicConnection, AleoWalletConnection } from './aleo.js'
import type { EvmConnection, EvmExecutionConnection, EvmPublicConnection } from './evm.js'
import type { SolanaConnection, SolanaExecutionConnection, SolanaPublicConnection } from './solana.js'

/** Represents every materialized bridge connection family. */
export type BridgeConnection = EvmConnection | SolanaConnection | AleoConnection

/** Stores materialized connections by registry chain identifier. */
export type BridgeConnections = Readonly<Record<string, BridgeConnection>>

function resolve(
  registry: BridgeRegistry,
  connections: BridgeConnections,
  chainId: string,
  family: BridgeConnection['family'],
): BridgeConnection {
  const chain = registry.chains.find((entry) => entry.id === chainId)
  if (!chain) throw new BridgeError(`Unknown bridge chain: "${chainId}"`)
  const connection = connections[chainId]
  if (!connection) throw new BridgeError(`No connection is configured for chain "${chainId}"`)
  if (connection.family !== chain.family || connection.family !== family) {
    throw new BridgeError(`Connection "${chainId}" has family "${connection.family}"; the registry declares "${chain.family}"`)
  }
  return connection
}

/** Resolves an EVM connection with public access for one action. */
export function requireEvmPublicConnection(registry: BridgeRegistry, connections: BridgeConnections, chainId: string, action: string): EvmPublicConnection {
  const connection = resolve(registry, connections, chainId, 'evm') as EvmConnection
  if (!connection.publicClient) throw new BridgeError(`EVM public client is required to ${action} on chain "${chainId}"`)
  return connection as EvmPublicConnection
}

/** Resolves an EVM connection with public and wallet access for one action. */
export function requireEvmExecutionConnection(registry: BridgeRegistry, connections: BridgeConnections, chainId: string, action: string): EvmExecutionConnection {
  const connection = requireEvmPublicConnection(registry, connections, chainId, action)
  if (!connection.walletClient) throw new BridgeError(`EVM wallet client is required to ${action} on chain "${chainId}"`)
  return connection as EvmExecutionConnection
}

/** Resolves a Solana connection with public access for one action. */
export function requireSolanaPublicConnection(registry: BridgeRegistry, connections: BridgeConnections, chainId: string, action: string): SolanaPublicConnection {
  return resolve(registry, connections, chainId, 'solana') as SolanaPublicConnection
}

/** Resolves a Solana connection with public and wallet access for one action. */
export function requireSolanaExecutionConnection(registry: BridgeRegistry, connections: BridgeConnections, chainId: string, action: string): SolanaExecutionConnection {
  const connection = requireSolanaPublicConnection(registry, connections, chainId, action)
  if (!connection.walletClient) throw new BridgeError(`Solana wallet client is required to ${action} on chain "${chainId}"`)
  return connection as SolanaExecutionConnection
}

/** Resolves an Aleo connection with public access for one action. */
export function requireAleoPublicConnection(registry: BridgeRegistry, connections: BridgeConnections, chainId: string, action: string): AleoPublicConnection {
  const connection = resolve(registry, connections, chainId, 'aleo') as AleoConnection
  if (!connection.publicClient) throw new BridgeError(`Aleo public client is required to ${action} on chain "${chainId}"`)
  return connection as AleoPublicConnection
}

/** Resolves an Aleo connection with wallet access for one action. */
export function requireAleoWalletConnection(registry: BridgeRegistry, connections: BridgeConnections, chainId: string, action: string): AleoWalletConnection {
  const connection = resolve(registry, connections, chainId, 'aleo') as AleoConnection
  if (!connection.walletClient) throw new BridgeError(`Aleo wallet client is required to ${action} on chain "${chainId}"`)
  return connection as AleoWalletConnection
}
