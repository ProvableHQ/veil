import type { Client } from '../../clients/createClient.js'
import type { Transaction } from '../../types/transaction.js'

export type GetUnconfirmedTransactionParameters = { id: string }
export type GetUnconfirmedTransactionReturnType = Transaction

export async function getUnconfirmedTransaction(
  client: Client,
  params: GetUnconfirmedTransactionParameters,
): Promise<GetUnconfirmedTransactionReturnType> {
  return client.request({
    method: 'getUnconfirmedTransaction',
    params: { id: params.id },
  }) as Promise<GetUnconfirmedTransactionReturnType>
}
