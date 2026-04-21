import type { Client } from '../../clients/createClient.js'
import type { ConfirmedTransaction } from '../../types/block.js'

export type GetConfirmedTransactionParameters = { id: string }
export type GetConfirmedTransactionReturnType = ConfirmedTransaction

export async function getConfirmedTransaction(
  client: Client,
  params: GetConfirmedTransactionParameters,
): Promise<GetConfirmedTransactionReturnType> {
  return client.request({
    method: 'getConfirmedTransaction',
    params: { id: params.id },
  }) as Promise<GetConfirmedTransactionReturnType>
}
