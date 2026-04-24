import type { Client } from '../../clients/createClient.js'

export type GetProgramAddressParameters = { programId: string }
export type GetProgramAddressReturnType = string

/** Resolves a program ID to its on-chain address. */
export async function getProgramAddress(
  client: Client,
  params: GetProgramAddressParameters,
): Promise<GetProgramAddressReturnType> {
  return client.request({
    method: 'getProgramAddress',
    params: { programId: params.programId },
  }) as Promise<GetProgramAddressReturnType>
}
