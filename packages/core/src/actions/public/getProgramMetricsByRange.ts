import type { Client } from '../../clients/createClient.js'

export type ProgramMetricsDayPoint = {
  day: string
  calls: number
}

export type GetProgramMetricsByRangeParameters = {
  programId: string
  /** Window in days — 30, 60, or 90 per the spec. */
  days: 30 | 60 | 90
}

export type GetProgramMetricsByRangeReturnType = ProgramMetricsDayPoint[]

export async function getProgramMetricsByRange(
  client: Client,
  params: GetProgramMetricsByRangeParameters,
): Promise<GetProgramMetricsByRangeReturnType> {
  return client.request({
    method: 'getProgramMetricsByRange',
    params: { programId: params.programId, days: params.days },
  }) as Promise<GetProgramMetricsByRangeReturnType>
}
