import type { Client } from '../../clients/createClient.js'

export type GetValidatorApyReturnType = unknown

export async function getValidatorApy(client: Client): Promise<GetValidatorApyReturnType> {
  return client.request({ method: 'getValidatorApy' })
}
