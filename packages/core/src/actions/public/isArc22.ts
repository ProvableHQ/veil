import type { Client } from '../../clients/createClient.js'
import { checkArcConformance, type ArcProgramSource } from './checkArcConformance.js'

/** Alias for {@link ArcProgramSource}. */
export type IsArc22Parameters = ArcProgramSource

/** True when the program conforms to ARC-22. */
export type IsArc22ReturnType = boolean

/**
 * Checks whether a program conforms to the ARC-22 compliant fungible token
 * standard (the IARC22 token interface; the separate IARC22Freezelist
 * interface is out of scope).
 *
 * Thin wrapper over {@link checkArcConformance} returning only the verdict;
 * call that action for the full violation report. With `programId` the
 * program is fetched from the connected node; with `source` the check is
 * purely local.
 *
 * @param client Client whose transport serves the fetch when `programId` is used.
 * @param params Program id to fetch, or program source to analyze locally.
 * @returns True when the program satisfies the full IARC22 token interface.
 *
 * @example
 * const ok = await client.isArc22({ programId: 'stablecoin.aleo' })
 */
export async function isArc22(client: Client, params: IsArc22Parameters): Promise<IsArc22ReturnType> {
  const report = await checkArcConformance(client, { ...params, standard: 'arc22' })
  return report.conforms
}
