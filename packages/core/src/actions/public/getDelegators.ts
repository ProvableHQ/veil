import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getDelegators}.
 *
 * @property validator Validator address (`aleo1...`) whose delegators to list.
 */
export type GetDelegatorsParameters = { validator: string }
/** Array of delegator addresses (aleo1...) bonded to the validator. */
export type GetDelegatorsReturnType = string[]

/**
 * Retrieves the addresses of all delegators bonded to a validator.
 *
 * Queries the connected Aleo node, so it hits the network. Use it to inspect
 * a validator's delegation base; pair with `getCommittee` for the
 * validator's own stake and status.
 *
 * @param client Client whose transport serves the query.
 * @param params Validator to inspect.
 * @returns The delegator addresses currently bonded to the validator.
 *
 * @example
 * const delegators = await client.getDelegators({ validator: 'aleo1...' })
 */
export async function getDelegators(
  client: Client,
  params: GetDelegatorsParameters,
): Promise<GetDelegatorsReturnType> {
  return client.request({
    method: 'getDelegators',
    params: { validator: params.validator },
  }) as Promise<GetDelegatorsReturnType>
}
