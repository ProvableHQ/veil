import type { Client } from '../../clients/createClient.js'

export type FindTransitionIdParameters = { inputOrOutputId: string }
export type FindTransitionIdReturnType = string

export async function findTransitionId(
  client: Client,
  params: FindTransitionIdParameters,
): Promise<FindTransitionIdReturnType> {
  return client.request({
    method: 'findTransitionId',
    params: { inputOrOutputId: params.inputOrOutputId },
  }) as Promise<FindTransitionIdReturnType>
}
