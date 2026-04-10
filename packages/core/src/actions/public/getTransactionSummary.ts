import type { Client } from '../../clients/createClient.js'

export type GetTransactionSummaryReturnType = unknown

export async function getTransactionSummary(client: Client): Promise<GetTransactionSummaryReturnType> {
  return client.request({ method: 'getTransactionSummary' })
}
