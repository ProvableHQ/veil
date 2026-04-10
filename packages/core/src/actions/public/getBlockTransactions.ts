import type { Client } from '../../clients/createClient.js'

export type GetBlockTransactionsParameters = { height: number }
export type GetBlockTransactionsReturnType = unknown[]

export async function getBlockTransactions(
  client: Client,
  params: GetBlockTransactionsParameters,
): Promise<GetBlockTransactionsReturnType> {
  return client.request({
    method: 'getBlockTransactions',
    params: { height: params.height },
  }) as Promise<GetBlockTransactionsReturnType>
}
