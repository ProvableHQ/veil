import type { Client } from '../../clients/createClient.js'
import type { TransactionSummary } from '../../types/network.js'

/** Summaries of the most recent transactions on the network. */
export type GetTransactionSummaryReturnType = TransactionSummary[]

/**
 * Fetches summaries of the most recent transactions network-wide.
 *
 * Each summary carries the transaction id, fee in microcredits, status, block
 * placement, and the program and function called. Reach for this for an
 * explorer-style latest-transactions feed; use `getTransaction` for a full
 * body. Queries the connected node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @returns One summary per recent transaction, newest first.
 *
 * @example
 * const latest = await client.getTransactionSummary()
 */
export async function getTransactionSummary(client: Client): Promise<GetTransactionSummaryReturnType> {
  return client.request({ method: 'getTransactionSummary' }) as Promise<GetTransactionSummaryReturnType>
}
