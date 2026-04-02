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
  if (!client.account || !('signMessage' in client.account)) {
    throw new AccountNotFoundError()
  }

  return (client.account as SignerAccount).signMessage(params.message)
}
