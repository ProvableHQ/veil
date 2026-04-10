import type { Client } from '../../clients/createClient.js'

export type GetProgramMetricsReturnType = unknown

export async function getProgramMetrics(client: Client): Promise<GetProgramMetricsReturnType> {
  return client.request({ method: 'getProgramMetrics' })
}
