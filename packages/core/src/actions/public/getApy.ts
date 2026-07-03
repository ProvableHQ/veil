import type { Client } from '../../clients/createClient.js'

/** Decimal APY for the network (e.g. 10.9 ≈ 10.9%). */
export type GetApyReturnType = number

/**
 * Retrieves the current network-wide staking APY.
 *
 * Queries the connected Aleo node, so it hits the network. Reach for it to
 * show an estimated staking yield; use `getValidatorApy` for per-validator
 * rates.
 *
 * @param client Client whose transport serves the query.
 * @returns The current APY as a decimal percentage (10.9 means 10.9%).
 *
 * @example
 * const apy = await client.getApy()
 */
export async function getApy(client: Client): Promise<GetApyReturnType> {
  return client.request({ method: 'getApy' }) as Promise<GetApyReturnType>
}
