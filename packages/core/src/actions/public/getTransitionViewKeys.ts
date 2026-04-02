import type { Client } from '../../clients/createClient.js'

export type GetTransitionViewKeysParameters = { transactionId: string }
export type GetTransitionViewKeysReturnType = string[]

export async function getTransitionViewKeys(
  client: Client,
  params: GetTransitionViewKeysParameters,
): Promise<GetTransitionViewKeysReturnType> {
  return client.request({
    method: 'getTransitionViewKeys',
    params: { id: params.transactionId },
  }) as Promise<string[]>
}
