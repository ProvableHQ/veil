import type { Client } from '../../clients/createClient.js'
import type { TransactionMetricPoint } from '../../types/network.js'

/** Daily transaction counts across the network. */
export type GetTransactionMetricsReturnType = TransactionMetricPoint[]

/**
 * Fetches daily transaction counts for the network.
 *
 * Each point pairs a day bucket with the number of transactions that day.
 * Reach for this to chart network activity over time. Queries the connected
 * node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @returns One point per day.
 *
 * @example
 * const points = await client.getTransactionMetrics()
 */
export async function getTransactionMetrics(client: Client): Promise<GetTransactionMetricsReturnType> {
  return client.request({ method: 'getTransactionMetrics' }) as Promise<GetTransactionMetricsReturnType>
}
