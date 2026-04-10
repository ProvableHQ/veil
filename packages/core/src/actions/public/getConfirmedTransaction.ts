import type { Client } from '../../clients/createClient.js'

export type GetConfirmedTransactionParameters = { id: string }
export type GetConfirmedTransactionReturnType = unknown

export async function getConfirmedTransaction(
  client: Client,
  params: GetConfirmedTransactionParameters,
): Promise<GetConfirmedTransactionReturnType> {
  return client.request({
    method: 'getConfirmedTransaction',
    params: { id: params.id },
  })
}
