import type { Client } from '../../clients/createClient.js'

export type GetTransactionsByAddressParameters = { address: string }
export type GetTransactionsByAddressReturnType = unknown[]

export async function getTransactionsByAddress(
  client: Client,
  params: GetTransactionsByAddressParameters,
): Promise<GetTransactionsByAddressReturnType> {
  return client.request({
    method: 'getTransactionsByAddress',
    params: { address: params.address },
  }) as Promise<GetTransactionsByAddressReturnType>
}
