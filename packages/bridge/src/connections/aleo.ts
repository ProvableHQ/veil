import type { Client } from '@provablehq/veil-core'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { AleoWalletClient } from '../types/aleo.js'

/**
 * Configures one registry-keyed Aleo connection.
 * @property family Discriminator added by {@link aleoConnection}.
 * @property publicClient Required Veil public client used for chain reads.
 * @property account Optional Veil-compatible wallet client used for execution.
 */
export type AleoConnectionDefinition = {
  family: 'aleo'
  publicClient: Client
  account?: AleoWalletClient | undefined
}

/**
 * Holds materialized Aleo public and wallet capabilities.
 * @property family Aleo family discriminator.
 * @property publicClient Required Veil public client.
 * @property walletClient Optional Veil-compatible execution client.
 */
export type AleoConnection = {
  family: 'aleo'
  publicClient: Client
  walletClient?: AleoWalletClient | undefined
}

/**
 * Requires the wallet side of an otherwise readable Aleo connection.
 *
 * @property walletClient Account-authorized client used to prove, sign, and broadcast.
 */
export type AleoWalletConnection = AleoConnection & { walletClient: AleoWalletClient }

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
 * Creates and statically validates an inert Aleo connection definition.
 * @param config Required public client and optional wallet account.
 * @returns A registry-ready Aleo connection definition.
 * @throws BridgeError When the public client is absent.
 * @example const connection = aleoConnection({ publicClient, account: walletClient })
 */
export function aleoConnection(
  config: Omit<AleoConnectionDefinition, 'family'>,
): AleoConnectionDefinition {
  if (!config.publicClient) throw new BridgeError('Aleo connection requires a public client')
  return { family: 'aleo', ...config }
}

/** Materializes an Aleo definition while preserving native core clients. */
export function materializeAleoConnection(definition: AleoConnectionDefinition): AleoConnection {
  return { family: 'aleo', publicClient: definition.publicClient, walletClient: definition.account }
}
