import type { Client } from '../../clients/createClient.js'

export type GetTransitionsParameters = { address: string }
export type GetTransitionsReturnType = unknown[]

export async function getTransitions(
  client: Client,
  params: GetTransitionsParameters,
): Promise<GetTransitionsReturnType> {
  return client.request({
    method: 'getTransitions',
    params: { address: params.address },
  }) as Promise<GetTransitionsReturnType>
}
