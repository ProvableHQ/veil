import type { Client } from '../../clients/createClient.js'

export type GetProgramIdByAddressParameters = { address: string }
export type GetProgramIdByAddressReturnType = string

/** Resolves a program's on-chain address to its program ID. */
export async function getProgramIdByAddress(
  client: Client,
  params: GetProgramIdByAddressParameters,
): Promise<GetProgramIdByAddressReturnType> {
  return client.request({
    method: 'getProgramIdByAddress',
    params: { address: params.address },
  }) as Promise<GetProgramIdByAddressReturnType>
}
