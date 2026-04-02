import type { SignerAccount } from '../types/account.js'
import type { ProvingConfig } from '../types/proving.js'
import type { RecordsConfig } from '../types/records.js'
import type { Transport } from '../types/transport.js'
import { createClient, type Client } from './createClient.js'
import { walletActions, type WalletActions } from './decorators/wallet.js'

/** Config for RPC account — proving is excluded, wallet handles it */
export type RpcWalletClientConfig = {
  account: SignerAccount & { type: 'rpc' }
  transport: Transport
  records?: RecordsConfig | undefined
  key?: string | undefined
  name?: string | undefined
}

/** Config for local account — must provide proving config */
export type LocalWalletClientConfig = {
  account: SignerAccount & { type: 'local' }
  transport: Transport
  proving: ProvingConfig
  records?: RecordsConfig | undefined
  key?: string | undefined
  name?: string | undefined
}

export type WalletClientConfig = RpcWalletClientConfig | LocalWalletClientConfig

export type WalletClient = Client & WalletActions

export function createWalletClient(config: WalletClientConfig): WalletClient {
  const { key = 'wallet', name = 'Wallet Client', ...rest } = config
  const client = createClient({
    ...rest,
    proving: 'proving' in rest ? rest.proving : undefined,
    key,
    name,
  })
  return client.extend(walletActions) as WalletClient
}
