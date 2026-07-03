import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getCode}.
 *
 * @property programId Program (e.g. `credits.aleo`) whose source to fetch.
 */
export type GetCodeParameters = { programId: string }

/** Aleo instructions source of the deployed program. */
export type GetCodeReturnType = string

/**
 * Retrieves the source code of a deployed program.
 *
 * Queries the connected Aleo node, so it hits the network. The result is the
 * program's Aleo instructions text — Veil's analogue of viem's `getCode`,
 * which returns bytecode. Use it to inspect a program's functions,
 * mappings, and record types before calling it.
 *
 * @param client Client whose transport serves the query.
 * @param params Program to fetch.
 * @returns The program source as Aleo instructions.
 *
 * @example
 * const source = await client.getCode({ programId: 'credits.aleo' })
 */
export async function getCode(client: Client, params: GetCodeParameters): Promise<GetCodeReturnType> {
  return client.request({ method: 'getProgram', params: { programId: params.programId } }) as Promise<string>
}

/** Alias for {@link getCode} — fetches Aleo program source by program id. */
export const getProgram = getCode
/** Alias for {@link GetCodeParameters}. */
export type GetProgramParameters = GetCodeParameters
/** Alias for {@link GetCodeReturnType}. */
export type GetProgramReturnType = GetCodeReturnType
