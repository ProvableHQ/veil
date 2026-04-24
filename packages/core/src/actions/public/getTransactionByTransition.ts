import type { Client } from '../../clients/createClient.js'
import type { Transaction } from '../../types/transaction.js'
import { findTransactionId } from './findTransactionId.js'
import { getTransaction } from './getTransaction.js'

export type GetTransactionByTransitionParameters = { transitionId: string }
export type GetTransactionByTransitionReturnType = Transaction

/**
 * Fetches a full transaction by transition ID. Composes two REST calls:
 * `/find/transactionID/{transitionId}` to resolve the transaction id, then
 * `/transaction/{id}` to fetch the transaction body.
 */
export async function getTransactionByTransition(
  client: Client,
  params: GetTransactionByTransitionParameters,
): Promise<GetTransactionByTransitionReturnType> {
  const id = await findTransactionId(client, { transitionId: params.transitionId })
  return getTransaction(client, { id })
}
