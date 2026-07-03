import type { Client } from '../../clients/createClient.js'

/**
 * One day of call activity for a program.
 *
 * @property day Day bucket, as an ISO-8601 date string.
 * @property calls Number of calls into the program that day.
 */
export type ProgramMetricsDayPoint = {
  day: string
  calls: number
}

/**
 * Parameters for {@link getProgramMetricsByRange}.
 *
 * @property programId Program whose activity to fetch.
 * @property days Trailing window in days — the endpoint accepts 30, 60, or 90.
 */
export type GetProgramMetricsByRangeParameters = {
  programId: string
  days: 30 | 60 | 90
}

/** Daily call counts over the requested window. */
export type GetProgramMetricsByRangeReturnType = ProgramMetricsDayPoint[]

/**
 * Fetches a program's daily call counts over a trailing window.
 *
 * Use it to chart one program's activity over time; use
 * `getProgramMetrics` for a network-wide snapshot. Queries the connected node,
 * so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @param params Program and window length.
 * @returns One point per day in the window.
 *
 * @example
 * const points = await client.getProgramMetricsByRange({ programId: 'credits.aleo', days: 30 })
 */
export async function getProgramMetricsByRange(
  client: Client,
  params: GetProgramMetricsByRangeParameters,
): Promise<GetProgramMetricsByRangeReturnType> {
  return client.request({
    method: 'getProgramMetricsByRange',
    params: { programId: params.programId, days: params.days },
  }) as Promise<GetProgramMetricsByRangeReturnType>
}
