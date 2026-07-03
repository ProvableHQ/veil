import type { Client } from '../../clients/createClient.js'

/**
 * Summary row for one transaction in a block, in API wire format.
 *
 * @property id Transaction id (`at1...`).
 * @property fee Fee paid, in microcredits (u64).
 * @property status Whether the transaction was accepted or rejected.
 * @property block_height Height (u32) of the containing block.
 * @property block_timestamp Unix-seconds timestamp as a string (API wire format).
 * @property block_hash Hash (`ab1...`) of the containing block.
 * @property transaction_type Kind of transaction, e.g. `execute` or `deploy`.
 * @property program_id Program the root transition called.
 * @property function_id Function the root transition called.
 */
export type BlockTransactionSummary = {
  id: string
  fee: number
  status: string
  block_height: number
  block_timestamp: string
  block_hash: string
  transaction_type: string
  program_id: string
  function_id: string
}

/**
 * Parameters for {@link getBlockTransactionsByHash}.
 *
 * @property hash Block hash (`ab1...`) whose transactions to fetch.
 */
export type GetBlockTransactionsByHashParameters = { hash: string }

/**
 * Wrapper around the block's transaction summaries.
 *
 * @property transactions One summary row per transaction in the block.
 */
export type GetBlockTransactionsByHashReturnType = { transactions: BlockTransactionSummary[] }

/**
 * Retrieves summary rows for the transactions in a block, looked up by block
 * hash.
 *
 * Queries the connected Aleo node, so it hits the network. Returns lightweight
 * summaries (id, fee, status, program and function called) rather than full
 * transactions; use `getBlockTransactions` with a height for the complete
 * confirmed transactions.
 *
 * @param client Client whose transport serves the query.
 * @param params Block to read transactions from.
 * @returns Summary rows for each transaction in the block.
 *
 * @example
 * const { transactions } = await client.getBlockTransactionsByHash({ hash: 'ab1...' })
 */
export async function getBlockTransactionsByHash(
  client: Client,
  params: GetBlockTransactionsByHashParameters,
): Promise<GetBlockTransactionsByHashReturnType> {
  return client.request({
    method: 'getBlockTransactionsByHash',
    params: { hash: params.hash },
  }) as Promise<GetBlockTransactionsByHashReturnType>
}
