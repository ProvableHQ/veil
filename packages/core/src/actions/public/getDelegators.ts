import type { Client } from '../../clients/createClient.js'

export type GetDelegatorsParameters = { validator: string }
export type GetDelegatorsReturnType = unknown

export async function getDelegators(
  client: Client,
  params: GetDelegatorsParameters,
): Promise<GetDelegatorsReturnType> {
  return client.request({
    method: 'getDelegators',
    params: { validator: params.validator },
  })
}
