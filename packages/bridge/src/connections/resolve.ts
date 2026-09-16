import { BridgeError } from '../errors/bridgeErrors.js'
import type { BridgeRegistry } from '../types/protocol.js'
import type { AleoClient } from './aleo.js'
import type { AleoWalletClient } from '../types/aleo.js'
import type { EvmClient, EvmWalletClient } from './evm.js'
import type { SolanaClient, SolanaWalletClient } from './solana.js'

/** Represents the EVM, Solana, or Aleo network access stored for one registry chain. */
export type BridgeChainClient = EvmClient | SolanaClient | AleoClient

/** Stores network and optional wallet access under the same chain identifiers used by routes. */
export type BridgeChainClients = Readonly<Record<string, BridgeChainClient>>

function resolve(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  chainId: string,
  family: BridgeChainClient['family'],
): BridgeChainClient {
  // Check both the registry declaration and the client discriminator. A client
  // stored under the wrong key must fail before any RPC request or signature.
  const chain = registry.chains.find((entry) => entry.id === chainId)
  if (!chain) throw new BridgeError(`Unknown bridge chain: "${chainId}"`)
  const client = clients[chainId]
  if (!client) throw new BridgeError(`No client is configured for chain "${chainId}"`)
  if (client.family !== chain.family || client.family !== family) {
    throw new BridgeError(`Client "${chainId}" has family "${client.family}"; the registry declares "${chain.family}"`)
  }
  return client
}

/** Returns EVM network access for a registry chain without requiring wallet authorization. */
export function requireEvmClient(registry: BridgeRegistry, clients: BridgeChainClients, chainId: string): EvmClient {
  return resolve(registry, clients, chainId, 'evm') as EvmClient
}

/** Returns EVM network and wallet access, or fails before an action can request a signature. */
export function requireEvmClientWithWallet(registry: BridgeRegistry, clients: BridgeChainClients, chainId: string, action: string): EvmClient & { walletClient: EvmWalletClient } {
  const client = requireEvmClient(registry, clients, chainId)
  if (!client.walletClient) throw new BridgeError(`EVM wallet client is required to ${action} on chain "${chainId}"`)
  return client as EvmClient & { walletClient: EvmWalletClient }
}

/** Returns Solana network access for a registry chain without requiring wallet authorization. */
export function requireSolanaClient(registry: BridgeRegistry, clients: BridgeChainClients, chainId: string): SolanaClient {
  return resolve(registry, clients, chainId, 'solana') as SolanaClient
}

/** Returns Solana network and wallet access, or fails before an action can request a signature. */
export function requireSolanaClientWithWallet(registry: BridgeRegistry, clients: BridgeChainClients, chainId: string, action: string): SolanaClient & { walletClient: SolanaWalletClient } {
  const client = requireSolanaClient(registry, clients, chainId)
  if (!client.walletClient) throw new BridgeError(`Solana wallet client is required to ${action} on chain "${chainId}"`)
  return client as SolanaClient & { walletClient: SolanaWalletClient }
}

/** Returns Aleo network access for a registry chain without requiring wallet authorization. */
export function requireAleoClient(registry: BridgeRegistry, clients: BridgeChainClients, chainId: string): AleoClient {
  return resolve(registry, clients, chainId, 'aleo') as AleoClient
}

/** Returns Aleo network and wallet access, or fails before an action can request proving or a signature. */
export function requireAleoClientWithWallet(registry: BridgeRegistry, clients: BridgeChainClients, chainId: string, action: string): AleoClient & { walletClient: AleoWalletClient } {
  const client = requireAleoClient(registry, clients, chainId)
  if (!client.walletClient) throw new BridgeError(`Aleo wallet client is required to ${action} on chain "${chainId}"`)
  return client as AleoClient & { walletClient: AleoWalletClient }
}
