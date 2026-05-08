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
  /** Record provider for fetching records. Required if you need requestRecords with a local account. */
  recordProvider?: RecordProvider
  key?: string | undefined
  name?: string | undefined
}

export type WalletClientConfig = RpcWalletClientConfig | LocalWalletClientConfig

export type WalletClient = Client & WalletActions & {
  recordProvider: RecordProvider | undefined
}

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
