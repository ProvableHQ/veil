import type { Client } from '../../clients/createClient.js'

export type GetTransactionMetricsReturnType = unknown

export async function getTransactionMetrics(client: Client): Promise<GetTransactionMetricsReturnType> {
  return client.request({ method: 'getTransactionMetrics' })
}
