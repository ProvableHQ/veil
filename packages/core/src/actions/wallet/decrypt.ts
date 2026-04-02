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
  if (!client.account) {
    throw new AccountNotFoundError()
  }

  return client.request({
    method: 'decrypt',
    params,
  }) as Promise<string>
}
