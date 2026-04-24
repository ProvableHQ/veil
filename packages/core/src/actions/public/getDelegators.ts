import type { Client } from '../../clients/createClient.js'

export type GetDelegatorsParameters = { validator: string }
/** Array of delegator addresses (aleo1...) bonded to the validator. */
export type GetDelegatorsReturnType = string[]

export async function getDelegators(
  client: Client,
  params: GetDelegatorsParameters,
): Promise<GetDelegatorsReturnType> {
  return client.request({
    method: 'getDelegators',
    params: { validator: params.validator },
  }) as Promise<GetDelegatorsReturnType>
}
