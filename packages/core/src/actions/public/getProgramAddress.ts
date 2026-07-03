import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getProgramAddress}.
 *
 * @property programId Program whose address to resolve, such as `"credits.aleo"`.
 */
export type GetProgramAddressParameters = { programId: string }

/** The program's `aleo1…` account address. */
export type GetProgramAddressReturnType = string

/**
 * Resolves a program ID to its on-chain address.
 *
 * Every deployed program owns an `aleo1…` address derived from its ID. Use it
 * when a program appears as a party to a transfer, or to check a program's
 * public credits balance. Queries the connected node, so it hits the network.
 * Use `getProgramIdByAddress` for the reverse lookup.
 *
 * @param client Client whose transport serves the query.
 * @param params Program to resolve.
 * @returns The program's `aleo1…` address.
 *
 * @example
 * const address = await client.getProgramAddress({ programId: 'credits.aleo' })
 */
export async function getProgramAddress(
  client: Client,
  params: GetProgramAddressParameters,
): Promise<GetProgramAddressReturnType> {
  return client.request({
    method: 'getProgramAddress',
    params: { programId: params.programId },
  }) as Promise<GetProgramAddressReturnType>
}
