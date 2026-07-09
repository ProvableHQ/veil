import type { LocalAccount, RpcAccount } from '../types/account.js'

/**
 * Common fields for constructing an account with {@link toAccount}.
 *
 * The concrete account kind is selected by the `type` discriminant supplied
 * alongside these fields at the call site.
 *
 * @property address The account's Aleo address (`aleo1...`).
 * @property sign Optional callback that signs raw bytes. Required for accounts
 *   that must produce signatures; omit for address-only accounts.
 * @property signMessage Optional callback that signs a message. Required for
 *   accounts that must sign messages; omit for address-only accounts.
 */
export type ToAccountSource = {
  address: string
  sign?: (message: Uint8Array) => Promise<Uint8Array>
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>
}

/**
 * Constructs a typed account from a source object, branching on its `type`.
 *
 * Use for building an account without going through a specific
 * constructor: pass `type: 'rpc'` for wallet-delegated signing, or
 * `type: 'local'` with key material for local signing. Pure and local; it
 * shapes the input into an account and touches neither the network nor a key.
 *
 * @param source Account fields plus a `type` discriminant. A `'local'` source
 *   also carries `privateKey`, `viewKey`, and `source`.
 * @returns An {@link RpcAccount} for `type: 'rpc'`, or a {@link LocalAccount}
 *   for `type: 'local'`.
 *
 * @example
 * import { toAccount } from '@provablehq/veil-core'
 *
 * const account = toAccount({
 *   type: 'rpc',
 *   address: 'aleo1...',
 *   sign: (msg) => wallet.sign(msg),
 *   signMessage: (msg) => wallet.signMessage(msg),
 * })
 */
export function toAccount(source: ToAccountSource & { type: 'rpc' }): RpcAccount
export function toAccount(source: ToAccountSource & { type: 'local'; privateKey: string; viewKey: string; source: string }): LocalAccount
export function toAccount(source: ToAccountSource & Record<string, unknown>): RpcAccount | LocalAccount {
  return source as RpcAccount | LocalAccount
}
