import type { Client } from '../../clients/createClient.js'
import type { TransactionMetricPoint } from '../../types/network.js'

export type GetTransactionMetricsReturnType = TransactionMetricPoint[]

export async function getTransactionMetrics(client: Client): Promise<GetTransactionMetricsReturnType> {
  return client.request({ method: 'getTransactionMetrics' }) as Promise<GetTransactionMetricsReturnType>
}
