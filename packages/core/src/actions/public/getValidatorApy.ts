import type { Client } from '../../clients/createClient.js'
import type { ValidatorApy } from '../../types/network.js'

/** Estimated staking APY per validator. */
export type GetValidatorApyReturnType = ValidatorApy[]

/**
 * Fetches the estimated staking APY for each validator.
 *
 * Reach for this when choosing a validator to bond to; use `getApy` for the
 * network-wide rate. APY values are decimal percentages (10.9 means 10.9%).
 * Queries the connected node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @returns One entry per validator with its estimated APY.
 *
 * @example
 * const rates = await client.getValidatorApy()
 */
export async function getValidatorApy(client: Client): Promise<GetValidatorApyReturnType> {
  return client.request({ method: 'getValidatorApy' }) as Promise<GetValidatorApyReturnType>
}
