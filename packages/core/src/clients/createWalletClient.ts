import type { RpcAccount, LocalAccount } from '../types/account.js'
import type { ProvingConfig } from '../types/proving.js'
import type { RecordProvider } from '../types/records.js'
import type { Transport } from '../types/transport.js'
import { createClient, type Client } from './createClient.js'
import { walletActions, type WalletActions } from './decorators/wallet.js'

/** Config for RPC account — wallet handles proving and records */
export type RpcWalletClientConfig = {
  account: RpcAccount
  transport: Transport
  key?: string | undefined
  name?: string | undefined
  // No recordProvider — RPC wallets handle records via the wallet adapter
}

/** Config for local account — must provide a proving config (use mode: 'devnode' for devnode clients) */
export type LocalWalletClientConfig = {
  account: LocalAccount
  transport: Transport
  proving: ProvingConfig
  /** Record provider for fetching records. Required for requestRecords with a local account. */
  recordProvider?: RecordProvider
  key?: string | undefined
  name?: string | undefined
}

/**
 * Configuration for {@link createWalletClient}, one shape per account type.
 *
 * Use {@link RpcWalletClientConfig} with an RPC account, where the connected
 * wallet handles proving and records; use {@link LocalWalletClientConfig} with a
 * local account, where the caller supplies the proving configuration and,
 * optionally, a record provider.
 */
export type WalletClientConfig = RpcWalletClientConfig | LocalWalletClientConfig

/**
 * A base {@link Client} extended with the wallet actions (`writeContract`,
 * `transfer`, `signMessage`, and the rest) and a record provider.
 *
 * @property recordProvider Source of unspent records for a local account, or
 *   `undefined` for an RPC account (whose wallet supplies records).
 */
export type WalletClient = Client & WalletActions & {
  recordProvider: RecordProvider | undefined
}

/**
 * Creates a client that signs and submits transactions.
 *
 * Use for writes to the chain — calling programs, transferring credits, deploying,
 * and signing messages. Pass an RPC account to delegate proving and records to a
 * connected wallet, or a local account with a proving configuration to prove in
 * process. The returned client's write methods sign and hit the network.
 *
 * @param config An RPC or local wallet configuration; see {@link WalletClientConfig}.
 * @returns A client carrying every wallet action.
 *
 * @example
 * import { createWalletClient, http, rpcAccount } from '@veil/core'
 *
 * const client = createWalletClient({
 *   account: rpcAccount({
 *     address: 'aleo1...',
 *     sign: async (bytes) => bytes,
 *     signMessage: async (bytes) => bytes,
 *   }),
 *   transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
 * })
 */
export function createWalletClient(config: WalletClientConfig): WalletClient {
  const { key = 'wallet', name = 'Wallet Client', ...rest } = config
  const client = createClient({
    ...rest,
    proving: 'proving' in rest ? rest.proving : undefined,
    key,
    name,
  })

  const recordProvider = 'recordProvider' in rest ? rest.recordProvider : undefined

  const walletClient = client.extend(walletActions) as WalletClient
  ;(walletClient as any).recordProvider = recordProvider
  return walletClient
}
