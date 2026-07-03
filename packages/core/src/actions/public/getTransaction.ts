import type { Client } from '../../clients/createClient.js'
import type { Transaction } from '../../types/transaction.js'

/**
 * Parameters for {@link getTransaction}.
 *
 * @property id Transaction ID (`at1…`) to fetch.
 */
export type GetTransactionParameters = { id: string }

/** The full transaction as stored on chain. */
export type GetTransactionReturnType = Transaction

/**
 * Fetches a transaction by its `at1…` ID.
 *
 * Returns the transaction body as stored on chain. For the confirmed wrapper
 * carrying status and finalize operations use `getConfirmedTransaction`; for a
 * transaction's original as-submitted form (a rejected transaction's on-chain
 * body differs from what was broadcast) use `getUnconfirmedTransaction`.
 * Queries the connected node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @param params Transaction to fetch.
 * @returns The transaction body.
 * @throws When the node does not know the transaction ID.
 *
 * @example
 * const tx = await client.getTransaction({ id: 'at1…' })
 */
export async function getTransaction(client: Client, params: GetTransactionParameters): Promise<GetTransactionReturnType> {
  return client.request({ method: 'getTransaction', params: { id: params.id } }) as Promise<GetTransactionReturnType>
}
