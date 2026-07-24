import type { Client } from '../../clients/createClient.js'
import { checkProgramConformance, type ArcConformanceReport, type ArcStandard } from '../../contract/arcConformance.js'
import { ConfigurationError } from '../../errors/errors.js'
import { getCode } from './getCode.js'

/**
 * Identifies the program to analyze: either a deployed program id to fetch
 * from the connected node, or the full Aleo instructions text to analyze
 * locally. Exactly one of the two must be set.
 *
 * @property programId Deployed program to fetch (e.g. `token.aleo`). Hits the network.
 * @property source Full program text to analyze locally. No network access.
 */
export type ArcProgramSource =
  | { programId: string; source?: never }
  | { source: string; programId?: never }

/**
 * Parameters for {@link checkArcConformance}.
 *
 * @property standard ARC token interface to check against.
 */
export type CheckArcConformanceParameters = ArcProgramSource & { standard: ArcStandard }

/** Alias for {@link ArcConformanceReport}. */
export type CheckArcConformanceReturnType = ArcConformanceReport

// Resolves the program text: fetches by id when `programId` is set, or
// returns `source` directly. Throws unless exactly one of the two is given.
async function resolveArcProgramSource(client: Client, params: ArcProgramSource): Promise<string> {
  const bothOrNeither = (typeof params.source === 'string') === (typeof params.programId === 'string')
  if (bothOrNeither) {
    throw new ConfigurationError('Provide exactly one of `programId` or `source`.')
  }
  if (typeof params.source === 'string') return params.source
  return getCode(client, { programId: params.programId as string })
}

/**
 * Checks whether a program conforms to the ARC-20 or ARC-22 token standard
 * and reports every deviation.
 *
 * With `programId` the program text is fetched from the connected node; with
 * `source` the analysis is purely local. Conformance is verified structurally
 * against the interface's function, view, and record signatures — strict on
 * types and visibility at every register position — because the Leo-level
 * interface declaration does not survive compilation.
 *
 * @param client Client whose transport serves the fetch when `programId` is used.
 * @param params Program to analyze and the standard to check against.
 * @returns The conformance report; `conforms` is true when no violations were found.
 *
 * @example
 * const report = await client.checkArcConformance({ programId: 'token.aleo', standard: 'arc20' })
 * if (!report.conforms) console.log(report.violations)
 */
export async function checkArcConformance(
  client: Client,
  params: CheckArcConformanceParameters,
): Promise<CheckArcConformanceReturnType> {
  const source = await resolveArcProgramSource(client, params)
  return checkProgramConformance(source, params.standard)
}
