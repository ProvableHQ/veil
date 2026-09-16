import type { Client } from '@provablehq/veil-core'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { AleoWalletClient } from '../types/aleo.js'

/**
 * Configures Aleo network and optional wallet access for one named bridge chain.
 * @property publicClient Required Veil public client used for chain reads.
 * @property account Optional Veil-compatible wallet client used for execution.
 */
export type AleoClientConfig = {
  publicClient: Client
  account?: AleoWalletClient | undefined
}

/**
 * Holds materialized Aleo public and wallet capabilities.
 * @property family Prevents this client from being used for an EVM or Solana route stored under the wrong chain identifier.
 * @property publicClient Required Veil public client.
 * @property walletClient Optional Veil-compatible execution client.
 */
export type AleoClient = {
  family: 'aleo'
  publicClient: Client
  walletClient?: AleoWalletClient | undefined
}

/**
 * Selects the Aleo wallet that may authorize bridge and privacy transactions.
 *
 * The wallet retains custody of its account and proving configuration. This
 * helper does not connect to Aleo, request approval, or move funds.
 *
 * @param client Veil wallet client or compatible wallet adapter supplied by the application.
 * @returns The same wallet with only its transaction-execution capability exposed to the bridge.
 * @example const account = aleoWallet(aleoWalletClient)
 */
export function aleoWallet(client: AleoWalletClient): AleoWalletClient {
  return client
}

/**
 * Creates the Aleo client used to read bridge state and optionally authorize transactions.
 *
 * Construction stores the supplied clients without contacting Aleo or prompting
 * the wallet. Read-only actions need only `publicClient`; fund-moving actions
 * also require `account`.
 *
 * @param config Aleo network access and optional wallet authorization supplied by the application.
 * @returns Aleo read and optional wallet capabilities used by bridge actions.
 * @throws BridgeError When the public client is absent.
 * @example const client = createAleoClient({ publicClient, account: walletClient })
 */
export function createAleoClient(
  config: AleoClientConfig,
): AleoClient {
  if (!config.publicClient) throw new BridgeError('Aleo client requires a public client')
  return { family: 'aleo', publicClient: config.publicClient, walletClient: config.account }
}
