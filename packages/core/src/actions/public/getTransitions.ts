import type { Client } from '../../clients/createClient.js'
import type { TransitionSummary } from '../../types/network.js'

export type GetTransitionsParameters = { address: string }
export type GetTransitionsReturnType = TransitionSummary[]

export async function getTransitions(
  client: Client,
  params: GetTransitionsParameters,
): Promise<GetTransitionsReturnType> {
  return client.request({
    method: 'getTransitions',
    params: { address: params.address },
  }) as Promise<GetTransitionsReturnType>
}
