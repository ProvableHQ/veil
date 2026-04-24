import type { Client } from '../../clients/createClient.js'

export type GetProgramByEditionParameters = { programId: string; edition: number }
export type GetProgramByEditionReturnType = string

export async function getProgramByEdition(
  client: Client,
  params: GetProgramByEditionParameters,
): Promise<GetProgramByEditionReturnType> {
  return client.request({
    method: 'getProgramByEdition',
    params: { programId: params.programId, edition: params.edition },
  }) as Promise<GetProgramByEditionReturnType>
}
