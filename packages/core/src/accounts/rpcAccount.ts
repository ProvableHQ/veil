import type { RpcAccount } from '../types/account.js'

type RpcAccountSource = {
  address: string
  sign: (message: Uint8Array) => Promise<Uint8Array>
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
}

export function rpcAccount(source: RpcAccountSource): RpcAccount {
  return {
    type: 'rpc',
    address: source.address,
    sign: source.sign,
    signMessage: source.signMessage,
  }
}
