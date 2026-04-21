import type { Client } from '../../clients/createClient.js'
import type { ProgramMetricPoint } from '../../types/network.js'

export type GetProgramMetricsReturnType = ProgramMetricPoint[]

export async function getProgramMetrics(client: Client): Promise<GetProgramMetricsReturnType> {
  return client.request({ method: 'getProgramMetrics' }) as Promise<GetProgramMetricsReturnType>
}
