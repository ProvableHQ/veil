import type { Client } from '@provablehq/veil-core'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { AleoBridgeExecutor } from '../types/aleo.js'

/**
 * Configures one registry-keyed Aleo connection.
 * @property family Discriminator added by {@link aleoConnection}.
 * @property publicClient Optional Veil public client used for chain reads.
 * @property account Optional Veil-compatible wallet client used for execution.
 */
export type AleoConnectionDefinition = {
  family: 'aleo'
  publicClient?: Client | undefined
  account?: AleoBridgeExecutor | undefined
}

/**
 * Holds materialized Aleo public and wallet capabilities.
 * @property family Aleo family discriminator.
 * @property publicClient Optional Veil public client.
 * @property walletClient Optional Veil-compatible execution client.
 */
export type AleoConnection = {
  family: 'aleo'
  publicClient?: Client | undefined
  walletClient?: AleoBridgeExecutor | undefined
}

/** Requires the public side of an Aleo connection. */
export type AleoPublicConnection = AleoConnection & { publicClient: Client }

/** Requires the wallet side of an Aleo connection. */
export type AleoWalletConnection = AleoConnection & { walletClient: AleoBridgeExecutor }

/**
 * Adapts an Aleo wallet client for bridge authorization.
 * @param walletClient Veil wallet client or compatible adapter.
 * @returns The same client, typed as bridge execution authority.
 * @example const account = aleoWallet(aleoWalletClient)
 */
export function aleoWallet(walletClient: AleoBridgeExecutor): AleoBridgeExecutor {
  return walletClient
}

/**
 * Creates and statically validates an inert Aleo connection definition.
 * @param config Optional public client and wallet account; at least one is required.
 * @returns A registry-ready Aleo connection definition.
 * @throws BridgeError When neither capability is supplied.
 * @example const connection = aleoConnection({ publicClient, account: walletClient })
 */
export function aleoConnection(
  config: Omit<AleoConnectionDefinition, 'family'>,
): AleoConnectionDefinition {
  if (!config.publicClient && !config.account) {
    throw new BridgeError('Aleo connection requires a public or wallet capability')
  }
  return { family: 'aleo', ...config }
}

/** Materializes an Aleo definition while preserving native core clients. */
export function materializeAleoConnection(definition: AleoConnectionDefinition): AleoConnection {
  return { family: 'aleo', publicClient: definition.publicClient, walletClient: definition.account }
}
