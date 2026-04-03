import { AccountNotFoundError } from '../../errors/errors.js'
import type { SignerAccount } from '../../types/account.js'
import type { Client } from '../../clients/createClient.js'

export type SignMessageParameters = {
  message: Uint8Array
}

export type SignMessageReturnType = Uint8Array

export async function signMessage(
  client: Client,
  params: SignMessageParameters,
): Promise<SignMessageReturnType> {
  const account = client.account
  if (!account || !('signMessage' in account)) {
    throw new AccountNotFoundError()
  }

  // Like viem: if the account has signMessage, call it directly.
  // Both local and RPC accounts implement signMessage —
  // local accounts sign with the private key,
  // RPC accounts delegate to the wallet.
  return (account as SignerAccount).signMessage(params.message)
}
