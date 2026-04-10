import type { Client } from '../../clients/createClient.js'

export type GetUnconfirmedTransactionParameters = { id: string }
export type GetUnconfirmedTransactionReturnType = unknown

export async function getUnconfirmedTransaction(
  client: Client,
  params: GetUnconfirmedTransactionParameters,
): Promise<GetUnconfirmedTransactionReturnType> {
  return client.request({
    method: 'getUnconfirmedTransaction',
    params: { id: params.id },
  })
}
