import type { Client } from '../../clients/createClient.js'
import type { ValidatorApy } from '../../types/network.js'

export type GetValidatorApyReturnType = ValidatorApy[]

export async function getValidatorApy(client: Client): Promise<GetValidatorApyReturnType> {
  return client.request({ method: 'getValidatorApy' }) as Promise<GetValidatorApyReturnType>
}
