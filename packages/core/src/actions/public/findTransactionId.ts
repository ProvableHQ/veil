import type { Client } from '../../clients/createClient.js'

export type FindTransactionIdParameters = { transitionId: string }
export type FindTransactionIdReturnType = string

export async function findTransactionId(
  client: Client,
  params: FindTransactionIdParameters,
): Promise<FindTransactionIdReturnType> {
  return client.request({
    method: 'findTransactionId',
    params: { transitionId: params.transitionId },
  }) as Promise<FindTransactionIdReturnType>
}
