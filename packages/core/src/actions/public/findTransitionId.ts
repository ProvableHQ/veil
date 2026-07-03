import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link findTransitionId}.
 *
 * @property inputOrOutputId Input or output id (a field element, e.g. a record
 *   serial number or commitment) whose transition to locate.
 */
export type FindTransitionIdParameters = { inputOrOutputId: string }

/** Id (`au1...`) of the transition that consumed or produced the input/output. */
export type FindTransitionIdReturnType = string

/**
 * Finds the id of the transition that consumed or produced a given input or
 * output id.
 *
 * Queries the connected Aleo node, so it hits the network. Applies when the
 * caller holds a record serial number or commitment and needs the transition
 * that spent or created it; chain into `findTransactionId` for the
 * transaction.
 *
 * @param client Client whose transport serves the query.
 * @param params Input or output id to locate.
 * @returns The id of the transition containing the input or output.
 *
 * @example
 * const id = await client.findTransitionId({ inputOrOutputId: '1234...field' })
 */
export async function findTransitionId(
  client: Client,
  params: FindTransitionIdParameters,
): Promise<FindTransitionIdReturnType> {
  return client.request({
    method: 'findTransitionId',
    params: { inputOrOutputId: params.inputOrOutputId },
  }) as Promise<FindTransitionIdReturnType>
}
