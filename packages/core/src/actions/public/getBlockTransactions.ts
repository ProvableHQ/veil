import type { Client } from '../../clients/createClient.js'
import type { ConfirmedTransaction } from '../../types/block.js'

/**
 * Parameters for {@link getBlockTransactions}.
 *
 * @property height Block height (u32) whose transactions to fetch.
 */
export type GetBlockTransactionsParameters = { height: number }

/** Confirmed transactions in the block, each carrying its accepted/rejected status. */
export type GetBlockTransactionsReturnType = ConfirmedTransaction[]

/**
 * Retrieves the confirmed transactions in a block at a given height.
 *
 * Queries the connected Aleo node, so it hits the network. Applies when only
 * a block's transactions are needed; `getBlock` returns them along with
 * the header. Given a block hash instead of a height, use
 * `getBlockTransactionsByHash`.
 *
 * @param client Client whose transport serves the query.
 * @param params Block to read transactions from.
 * @returns The block's confirmed transactions with their accepted/rejected status.
 *
 * @example
 * const txs = await client.getBlockTransactions({ height: 100 })
 */
export async function getBlockTransactions(
  client: Client,
  params: GetBlockTransactionsParameters,
): Promise<GetBlockTransactionsReturnType> {
  return client.request({
    method: 'getBlockTransactions',
    params: { height: params.height },
  }) as Promise<GetBlockTransactionsReturnType>
}
