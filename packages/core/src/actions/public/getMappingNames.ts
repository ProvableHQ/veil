import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getMappingNames}.
 *
 * @property programId Program (e.g. `credits.aleo`) whose mappings to list.
 */
export type GetMappingNamesParameters = { programId: string }

/** Names of the program's on-chain mappings. Empty if the program declares none. */
export type GetMappingNamesReturnType = string[]

/**
 * Retrieves the names of the on-chain mappings a program declares.
 *
 * Queries the connected Aleo node, so it hits the network. Use it to
 * discover what public state a program exposes before reading values with
 * `readContract`.
 *
 * @param client Client whose transport serves the query.
 * @param params Program to inspect.
 * @returns The program's mapping names, e.g. `['account', 'committee']`.
 *
 * @example
 * const mappings = await client.getMappingNames({ programId: 'credits.aleo' })
 */
export async function getMappingNames(
  client: Client,
  params: GetMappingNamesParameters,
): Promise<GetMappingNamesReturnType> {
  return client.request({
    method: 'getMappingNames',
    params: { programId: params.programId },
  }) as Promise<GetMappingNamesReturnType>
}
