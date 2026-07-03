import type { Client } from '../../clients/createClient.js'
import type { Transaction } from '../../types/transaction.js'
import { findTransactionId } from './findTransactionId.js'
import { getTransaction } from './getTransaction.js'

/**
 * Parameters for {@link getTransactionByTransition}.
 *
 * @property transitionId Transition ID (`au1…`) contained in the transaction to fetch.
 */
export type GetTransactionByTransitionParameters = { transitionId: string }

/** The full transaction containing the transition. */
export type GetTransactionByTransitionReturnType = Transaction

/**
 * Fetches a full transaction by transition ID. Composes two REST calls:
 * `/find/transactionID/{transitionId}` to resolve the transaction id, then
 * `/transaction/{id}` to fetch the transaction body.
 *
 * Applies when an event or record only carries a transition id (`au1…`) and
 * the enclosing transaction is needed. Hits the network twice.
 *
 * @param client Client whose transport serves both queries.
 * @param params Transition to resolve.
 * @returns The transaction containing the transition.
 * @throws When the node does not know the transition ID.
 *
 * @example
 * const tx = await client.getTransactionByTransition({ transitionId: 'au1…' })
 */
export async function getTransactionByTransition(
  client: Client,
  params: GetTransactionByTransitionParameters,
): Promise<GetTransactionByTransitionReturnType> {
  const id = await findTransactionId(client, { transitionId: params.transitionId })
  return getTransaction(client, { id })
}
