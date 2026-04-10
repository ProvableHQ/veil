import type { Client } from '../../clients/createClient.js'

export type FindBlockHashParameters = { transactionId: string }
export type FindBlockHashReturnType = string

export async function findBlockHash(
  client: Client,
  params: FindBlockHashParameters,
): Promise<FindBlockHashReturnType> {
  return client.request({
    method: 'findBlockHash',
    params: { transactionId: params.transactionId },
  }) as Promise<FindBlockHashReturnType>
}
