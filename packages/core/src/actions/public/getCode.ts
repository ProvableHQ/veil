import type { Client } from '../../clients/createClient.js'

export type GetCodeParameters = { programId: string }
export type GetCodeReturnType = string

export async function getCode(client: Client, params: GetCodeParameters): Promise<GetCodeReturnType> {
  return client.request({ method: 'getProgram', params: { programId: params.programId } }) as Promise<string>
}

/** Alias for {@link getCode} — fetches Aleo program source by program id. */
export const getProgram = getCode
export type GetProgramParameters = GetCodeParameters
export type GetProgramReturnType = GetCodeReturnType
