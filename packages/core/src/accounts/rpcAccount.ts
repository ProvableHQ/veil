import type { RpcAccount } from '../types/account.js'

type RpcAccountSource = {
  address: string
  sign: (message: Uint8Array) => Promise<Uint8Array>
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
}

/**
 * Wraps an external signer as an RPC account for use with a wallet client.
 *
 * Applies when signing is delegated to a wallet or other provider that
 * holds the private key: the returned account carries the address and forwards
 * signing to the supplied callbacks. Building the account is pure; the `sign`
 * and `signMessage` callbacks are what hit the wallet.
 *
 * @param source Address and signing callbacks from the external provider.
 * @returns An account tagged `type: 'rpc'` that delegates signing to `source`.
 *
 * @example
 * import { rpcAccount } from '@provablehq/veil-core'
 *
 * const account = rpcAccount({
 *   address: 'aleo1...',
 *   sign: (msg) => wallet.sign(msg),
 *   signMessage: (msg) => wallet.signMessage(msg),
 * })
 */
export function rpcAccount(source: RpcAccountSource): RpcAccount {
  return {
    type: 'rpc',
    address: source.address,
    sign: source.sign,
    signMessage: source.signMessage,
  }
}
