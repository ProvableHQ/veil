import type { Client } from '../../clients/createClient.js'
import type { TransitionSummary } from '../../types/network.js'

/**
 * Parameters for {@link getTransitions}.
 *
 * @property address Address whose transitions to fetch.
 */
export type GetTransitionsParameters = { address: string }

/** Transition summaries involving the address. */
export type GetTransitionsReturnType = TransitionSummary[]

/**
 * Fetches transition summaries involving an address.
 *
 * Each summary carries the program and function called, the amount for
 * credits transfers, the containing transaction, and its status. Use it to
 * build an address's activity history. Queries the connected node, so
 * it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @param params Address to look up.
 * @returns One summary per transition involving the address.
 *
 * @example
 * const transitions = await client.getTransitions({ address: 'aleo1…' })
 */
export async function getTransitions(
  client: Client,
  params: GetTransitionsParameters,
): Promise<GetTransitionsReturnType> {
  return client.request({
    method: 'getTransitions',
    params: { address: params.address },
  }) as Promise<GetTransitionsReturnType>
}
