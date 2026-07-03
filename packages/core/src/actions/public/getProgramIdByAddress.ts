import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getProgramIdByAddress}.
 *
 * @property address Program account address (`aleo1…`) to look up.
 */
export type GetProgramIdByAddressParameters = { address: string }

/** The program ID, such as `"credits.aleo"`. */
export type GetProgramIdByAddressReturnType = string

/**
 * Resolves a program's on-chain address to its program ID.
 *
 * Inverse of `getProgramAddress`. Reach for this when an `aleo1…` address in a
 * transfer or transition turns out to belong to a program and you need to know
 * which one. Queries the connected node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @param params Address to look up.
 * @returns The ID of the program that owns the address.
 *
 * @example
 * const programId = await client.getProgramIdByAddress({ address: 'aleo1…' })
 */
export async function getProgramIdByAddress(
  client: Client,
  params: GetProgramIdByAddressParameters,
): Promise<GetProgramIdByAddressReturnType> {
  return client.request({
    method: 'getProgramIdByAddress',
    params: { address: params.address },
  }) as Promise<GetProgramIdByAddressReturnType>
}
