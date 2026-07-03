import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link findTransactionId}.
 *
 * @property transitionId Transition id (`au1...`) whose parent transaction to locate.
 */
export type FindTransactionIdParameters = { transitionId: string }

/** Id (`at1...`) of the transaction that contains the transition. */
export type FindTransactionIdReturnType = string

/**
 * Finds the id of the transaction that contains a transition.
 *
 * Queries the connected Aleo node, so it hits the network. Applies when an
 * event or record points at a transition and the enclosing transaction is
 * needed; follow up with `getTransaction({ id })` for its contents.
 *
 * @param client Client whose transport serves the query.
 * @param params Transition to locate.
 * @returns The id of the transaction the transition executed in.
 *
 * @example
 * const id = await client.findTransactionId({ transitionId: 'au1...' })
 */
export async function findTransactionId(
  client: Client,
  params: FindTransactionIdParameters,
): Promise<FindTransactionIdReturnType> {
  return client.request({
    method: 'findTransactionId',
    params: { transitionId: params.transitionId },
  }) as Promise<FindTransactionIdReturnType>
}
