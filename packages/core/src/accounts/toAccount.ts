import type { LocalAccount, RpcAccount } from '../types/account.js'

export type ToAccountSource = {
  address: string
  sign?: (message: Uint8Array) => Promise<Uint8Array>
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>
}

export function toAccount(source: ToAccountSource & { type: 'rpc' }): RpcAccount
export function toAccount(source: ToAccountSource & { type: 'local'; privateKey: string; viewKey: string; source: string }): LocalAccount
export function toAccount(source: ToAccountSource & Record<string, unknown>): RpcAccount | LocalAccount {
  return source as RpcAccount | LocalAccount
}
