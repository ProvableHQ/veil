import type { Client } from '../../clients/createClient.js'

export type BlockTransactionSummary = {
  id: string
  fee: number
  status: string
  block_height: number
  /** Unix-seconds timestamp as a string (API wire format). */
  block_timestamp: string
  block_hash: string
  transaction_type: string
  program_id: string
  function_id: string
}

export type GetBlockTransactionsByHashParameters = { hash: string }
export type GetBlockTransactionsByHashReturnType = { transactions: BlockTransactionSummary[] }

export async function getBlockTransactionsByHash(
  client: Client,
  params: GetBlockTransactionsByHashParameters,
): Promise<GetBlockTransactionsByHashReturnType> {
  return client.request({
    method: 'getBlockTransactionsByHash',
    params: { hash: params.hash },
  }) as Promise<GetBlockTransactionsByHashReturnType>
}
