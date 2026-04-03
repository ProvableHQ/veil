import { AccountNotFoundError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'

export type DecryptParameters = {
  ciphertext: string
  tpk?: string
  programId?: string
  functionName?: string
}

export type DecryptReturnType = string

export async function decrypt(
  client: Client,
  params: DecryptParameters,
): Promise<DecryptReturnType> {
  const account = client.account
  if (!account) {
    throw new AccountNotFoundError()
  }

  // RPC accounts — delegate to wallet which has the view key
  // Local/viewOnly accounts — also delegate to transport, which may
  // be backed by an SDK decrypt function or a wallet adapter
  return client.request({
    method: 'decrypt',
    params,
  }) as Promise<string>
}
