import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link findBlockHash}.
 *
 * @property transactionId Transaction id (`at1...`) whose containing block to locate.
 */
export type FindBlockHashParameters = { transactionId: string }

/** Hash (`ab1...`) of the block that contains the transaction. */
export type FindBlockHashReturnType = string

/**
 * Finds the hash of the block that contains a transaction.
 *
 * Queries the connected Aleo node, so it hits the network. Use it to resolve
 * a transaction id to its block; follow up with
 * `getBlock({ hash })` for the full block.
 *
 * @param client Client whose transport serves the query.
 * @param params Transaction to locate.
 * @returns The hash of the block the transaction was accepted into.
 *
 * @example
 * const hash = await client.findBlockHash({ transactionId: 'at1...' })
 */
export async function findBlockHash(
  client: Client,
  params: FindBlockHashParameters,
): Promise<FindBlockHashReturnType> {
  return client.request({
    method: 'findBlockHash',
    params: { transactionId: params.transactionId },
  }) as Promise<FindBlockHashReturnType>
}
