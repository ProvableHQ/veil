import type { Client } from '@provablehq/veil-core'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { AleoWalletClient } from '../types/aleo.js'

/**
 * Configures one registry-keyed Aleo client.
 * @property publicClient Required Veil public client used for chain reads.
 * @property account Optional Veil-compatible wallet client used for execution.
 */
export type AleoClientConfig = {
  publicClient: Client
  account?: AleoWalletClient | undefined
}

/**
 * Holds materialized Aleo public and wallet capabilities.
 * @property family Aleo family discriminator.
 * @property publicClient Required Veil public client.
 * @property walletClient Optional Veil-compatible execution client.
 */
export type AleoClient = {
  family: 'aleo'
  publicClient: Client
  walletClient?: AleoWalletClient | undefined
}

/**
 * Adapts an Aleo wallet client for bridge authorization.
 * @param walletClient Veil wallet client or compatible adapter.
 * @returns The same client, typed as bridge execution authority.
 * @example const account = aleoWallet(aleoWalletClient)
 */
export function aleoWallet(walletClient: AleoWalletClient): AleoWalletClient {
  return walletClient
}

/**
 * Creates an Aleo bridge client with public access and optional wallet authorization.
 * @param config Required public client and optional wallet account.
 * @returns A registry-ready Aleo client.
 * @throws BridgeError When the public client is absent.
 * @example const client = createAleoClient({ publicClient, account: walletClient })
 */
export function createAleoClient(
  config: AleoClientConfig,
): AleoClient {
  if (!config.publicClient) throw new BridgeError('Aleo client requires a public client')
  return { family: 'aleo', publicClient: config.publicClient, walletClient: config.account }
}
