import type { Client } from '../../clients/createClient.js'
import type { ProgramMetricPoint } from '../../types/network.js'

/** Call counts per program across the network. */
export type GetProgramMetricsReturnType = ProgramMetricPoint[]

/**
 * Fetches call counts for every program on the network.
 *
 * Reach for this to rank programs by activity or gauge a program's usage
 * against the rest of the network; use `getProgramMetricsByRange` for one
 * program's daily history. Queries the connected node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @returns One entry per program with its call count.
 *
 * @example
 * const metrics = await client.getProgramMetrics()
 */
export async function getProgramMetrics(client: Client): Promise<GetProgramMetricsReturnType> {
  return client.request({ method: 'getProgramMetrics' }) as Promise<GetProgramMetricsReturnType>
}
