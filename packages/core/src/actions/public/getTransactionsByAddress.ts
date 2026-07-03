import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getTransactionsByAddress}.
 *
 * @property address Address whose transactions to fetch.
 */
export type GetTransactionsByAddressParameters = { address: string }

/** Transactions involving the address, untyped in the endpoint's wire shape. */
export type GetTransactionsByAddressReturnType = unknown[]

/**
 * Fetches the transactions associated with an address.
 *
 * Returns the endpoint's wire shape untyped. Use `getTransitions` instead
 * for typed per-transition summaries of an address. Queries the
 * connected node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @param params Address to look up.
 * @returns The transactions involving the address.
 *
 * @example
 * const txs = await client.getTransactionsByAddress({ address: 'aleo1…' })
 */
export async function getTransactionsByAddress(
  client: Client,
  params: GetTransactionsByAddressParameters,
): Promise<GetTransactionsByAddressReturnType> {
  return client.request({
    method: 'getTransactionsByAddress',
    params: { address: params.address },
  }) as Promise<GetTransactionsByAddressReturnType>
}
