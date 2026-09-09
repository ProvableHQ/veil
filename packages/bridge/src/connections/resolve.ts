import { BridgeError } from '../errors/bridgeErrors.js'
import type { BridgeRegistry } from '../types/protocol.js'
import type { AleoClient } from './aleo.js'
import type { AleoWalletClient } from '../types/aleo.js'
import type { EvmClient, EvmWalletClient } from './evm.js'
import type { SolanaClient, SolanaWalletClient } from './solana.js'

/** Represents every materialized bridge client family. */
export type BridgeChainClient = EvmClient | SolanaClient | AleoClient

/** Stores materialized clients by registry chain identifier. */
export type BridgeChainClients = Readonly<Record<string, BridgeChainClient>>

function resolve(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  chainId: string,
  family: BridgeChainClient['family'],
): BridgeChainClient {
  const chain = registry.chains.find((entry) => entry.id === chainId)
  if (!chain) throw new BridgeError(`Unknown bridge chain: "${chainId}"`)
  const client = clients[chainId]
  if (!client) throw new BridgeError(`No client is configured for chain "${chainId}"`)
  if (client.family !== chain.family || client.family !== family) {
    throw new BridgeError(`Client "${chainId}" has family "${client.family}"; the registry declares "${chain.family}"`)
  }
  return client
}

/** Resolves the readable EVM client configured for one action. */
export function requireEvmClient(registry: BridgeRegistry, clients: BridgeChainClients, chainId: string): EvmClient {
  return resolve(registry, clients, chainId, 'evm') as EvmClient
}

/** Resolves an EVM client with wallet access for one action. */
export function requireEvmClientWithWallet(registry: BridgeRegistry, clients: BridgeChainClients, chainId: string, action: string): EvmClient & { walletClient: EvmWalletClient } {
  const client = requireEvmClient(registry, clients, chainId)
  if (!client.walletClient) throw new BridgeError(`EVM wallet client is required to ${action} on chain "${chainId}"`)
  return client as EvmClient & { walletClient: EvmWalletClient }
}

/** Resolves the readable Solana client configured for one action. */
export function requireSolanaClient(registry: BridgeRegistry, clients: BridgeChainClients, chainId: string): SolanaClient {
  return resolve(registry, clients, chainId, 'solana') as SolanaClient
}

/** Resolves a Solana client with wallet access for one action. */
export function requireSolanaClientWithWallet(registry: BridgeRegistry, clients: BridgeChainClients, chainId: string, action: string): SolanaClient & { walletClient: SolanaWalletClient } {
  const client = requireSolanaClient(registry, clients, chainId)
  if (!client.walletClient) throw new BridgeError(`Solana wallet client is required to ${action} on chain "${chainId}"`)
  return client as SolanaClient & { walletClient: SolanaWalletClient }
}

/** Resolves the readable Aleo client configured for one action. */
export function requireAleoClient(registry: BridgeRegistry, clients: BridgeChainClients, chainId: string): AleoClient {
  return resolve(registry, clients, chainId, 'aleo') as AleoClient
}

/** Resolves an Aleo client with wallet access for one action. */
export function requireAleoClientWithWallet(registry: BridgeRegistry, clients: BridgeChainClients, chainId: string, action: string): AleoClient & { walletClient: AleoWalletClient } {
  const client = requireAleoClient(registry, clients, chainId)
  if (!client.walletClient) throw new BridgeError(`Aleo wallet client is required to ${action} on chain "${chainId}"`)
  return client as AleoClient & { walletClient: AleoWalletClient }
}
