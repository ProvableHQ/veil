import { BridgeError } from '../errors/bridgeErrors.js'
import type { BridgeRegistry } from '../types/protocol.js'
import type { AleoConnection, AleoWalletConnection } from './aleo.js'
import type { EvmConnection, EvmWalletConnection } from './evm.js'
import type { SolanaConnection, SolanaWalletConnection } from './solana.js'

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

/** Resolves the readable EVM connection configured for one action. */
export function requireEvmConnection(registry: BridgeRegistry, connections: BridgeConnections, chainId: string): EvmConnection {
  return resolve(registry, connections, chainId, 'evm') as EvmConnection
}

/** Resolves an EVM connection with wallet access for one action. */
export function requireEvmWalletConnection(registry: BridgeRegistry, connections: BridgeConnections, chainId: string, action: string): EvmWalletConnection {
  const connection = requireEvmConnection(registry, connections, chainId)
  if (!connection.walletClient) throw new BridgeError(`EVM wallet client is required to ${action} on chain "${chainId}"`)
  return connection as EvmWalletConnection
}

/** Resolves the readable Solana connection configured for one action. */
export function requireSolanaConnection(registry: BridgeRegistry, connections: BridgeConnections, chainId: string): SolanaConnection {
  return resolve(registry, connections, chainId, 'solana') as SolanaConnection
}

/** Resolves a Solana connection with wallet access for one action. */
export function requireSolanaWalletConnection(registry: BridgeRegistry, connections: BridgeConnections, chainId: string, action: string): SolanaWalletConnection {
  const connection = requireSolanaConnection(registry, connections, chainId)
  if (!connection.walletClient) throw new BridgeError(`Solana wallet client is required to ${action} on chain "${chainId}"`)
  return connection as SolanaWalletConnection
}

/** Resolves the readable Aleo connection configured for one action. */
export function requireAleoConnection(registry: BridgeRegistry, connections: BridgeConnections, chainId: string): AleoConnection {
  return resolve(registry, connections, chainId, 'aleo') as AleoConnection
}

/** Resolves an Aleo connection with wallet access for one action. */
export function requireAleoWalletConnection(registry: BridgeRegistry, connections: BridgeConnections, chainId: string, action: string): AleoWalletConnection {
  const connection = requireAleoConnection(registry, connections, chainId)
  if (!connection.walletClient) throw new BridgeError(`Aleo wallet client is required to ${action} on chain "${chainId}"`)
  return connection as AleoWalletConnection
}
