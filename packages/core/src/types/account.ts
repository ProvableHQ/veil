/** Base account — address only, no sensitive material */
export type Account = {
  address: string
}

/** Account that can sign — either locally or via RPC */
export type SignerAccount = Account & {
  sign(message: Uint8Array): Promise<Uint8Array>
  signMessage(message: Uint8Array): Promise<Uint8Array>
}

/** Local account — has private key material, signs locally */
export type LocalAccount<source extends string = string> = SignerAccount & {
  type: 'local'
  source: source
  privateKey: string
  viewKey: string
}

/** RPC account — signing delegated to external provider (wallet) */
export type RpcAccount = SignerAccount & {
  type: 'rpc'
}

/** Union of all account types */
export type AnyAccount = LocalAccount | RpcAccount
