import type { Client } from '../../clients/createClient.js'
import type { Transaction } from '../../types/transaction.js'

export type GetTransactionParameters = { id: string }
export type GetTransactionReturnType = Transaction

export async function getTransaction(client: Client, params: GetTransactionParameters): Promise<GetTransactionReturnType> {
  return client.request({ method: 'getTransaction', params: { id: params.id } }) as Promise<GetTransactionReturnType>
}
