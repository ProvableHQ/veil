import type { Client } from '../../clients/createClient.js'
import type { ConfirmedTransaction } from '../../types/block.js'

export type GetBlockTransactionsParameters = { height: number }
export type GetBlockTransactionsReturnType = ConfirmedTransaction[]

export async function getBlockTransactions(
  client: Client,
  params: GetBlockTransactionsParameters,
): Promise<GetBlockTransactionsReturnType> {
  return client.request({
    method: 'getBlockTransactions',
    params: { height: params.height },
  }) as Promise<GetBlockTransactionsReturnType>
}
