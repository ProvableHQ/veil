import type { Client } from '../../clients/createClient.js'
import type { Transaction } from '../../types/transaction.js'

/**
 * Parameters for {@link getUnconfirmedTransaction}.
 *
 * @property id Transaction ID (`at1…`) to fetch.
 */
export type GetUnconfirmedTransactionParameters = { id: string }

/** The transaction in its original, as-submitted form. */
export type GetUnconfirmedTransactionReturnType = Transaction

/**
 * Fetches a transaction in its original, as-submitted form.
 *
 * What lands on chain can differ from what was broadcast: a rejected
 * execution is stored with its transitions replaced by the fee. Reach for
 * this to inspect the original payload of a rejected transaction; use
 * `getTransaction` for the on-chain form and `getConfirmedTransaction` for the
 * confirmed wrapper. Queries the connected node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @param params Transaction to fetch.
 * @returns The transaction as originally submitted.
 * @throws When the node does not know the transaction ID.
 *
 * @example
 * const original = await client.getUnconfirmedTransaction({ id: 'at1…' })
 */
export async function getUnconfirmedTransaction(
  client: Client,
  params: GetUnconfirmedTransactionParameters,
): Promise<GetUnconfirmedTransactionReturnType> {
  return client.request({
    method: 'getUnconfirmedTransaction',
    params: { id: params.id },
  }) as Promise<GetUnconfirmedTransactionReturnType>
}
