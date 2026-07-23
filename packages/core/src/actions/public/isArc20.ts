import type { Client } from '../../clients/createClient.js'
import { checkArcConformance, type ArcProgramSource } from './checkArcConformance.js'

/** Alias for {@link ArcProgramSource}. */
export type IsArc20Parameters = ArcProgramSource

/** True when the program conforms to ARC-20. */
export type IsArc20ReturnType = boolean

/**
 * Checks whether a program conforms to the ARC-20 fungible token standard.
 *
 * Thin wrapper over {@link checkArcConformance} returning only the verdict;
 * call that action for the full violation report. With `programId` the
 * program is fetched from the connected node; with `source` the check is
 * purely local.
 *
 * @param client Client whose transport serves the fetch when `programId` is used.
 * @param params Program id to fetch, or program source to analyze locally.
 * @returns True when the program satisfies the full IARC20 interface.
 *
 * @example
 * const ok = await client.isArc20({ programId: 'token.aleo' })
 */
export async function isArc20(client: Client, params: IsArc20Parameters): Promise<IsArc20ReturnType> {
  const report = await checkArcConformance(client, { ...params, standard: 'arc20' })
  return report.conforms
}
