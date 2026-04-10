import type { Client } from '../../clients/createClient.js'

export type GetProgramCallsParameters = { program: string }
export type GetProgramCallsReturnType = unknown[]

export async function getProgramCalls(
  client: Client,
  params: GetProgramCallsParameters,
): Promise<GetProgramCallsReturnType> {
  return client.request({
    method: 'getProgramCalls',
    params: { programId: params.program },
  }) as Promise<GetProgramCallsReturnType>
}
