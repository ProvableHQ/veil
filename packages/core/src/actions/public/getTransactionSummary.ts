import type { Client } from '../../clients/createClient.js'
import type { TransactionSummary } from '../../types/network.js'

export type GetTransactionSummaryReturnType = TransactionSummary[]

export async function getTransactionSummary(client: Client): Promise<GetTransactionSummaryReturnType> {
  return client.request({ method: 'getTransactionSummary' }) as Promise<GetTransactionSummaryReturnType>
}
