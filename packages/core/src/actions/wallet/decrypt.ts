import { AccountNotFoundError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'

export type DecryptParameters = {
  cipherText: string
  tpk?: string
  programId?: string
  functionName?: string
  index?: number
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

  // Local accounts — use the SDK-backed decrypt on the proving config.
  // The wallet adapter transport doesn't apply; we have the view key locally.
  if (account.type === 'local' && client.proving?.decrypt) {
    return client.proving.decrypt(
      params.cipherText,
      params.tpk,
      params.programId,
      params.functionName,
      params.index,
    )
  }

  // RPC accounts — delegate to the wallet adapter via the transport.
  return client.request({
    method: 'decrypt',
    params,
  }) as Promise<string>
}
