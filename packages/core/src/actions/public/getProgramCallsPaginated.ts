import type { Client } from '../../clients/createClient.js'

export type ProgramCallsCursor = {
  block_number: number
  transition_id: string
}

export type ProgramCall = {
  transaction_id: string
  function_id: string
  block_number: number
  /** Unix-seconds timestamp as a string (API wire format). */
  block_timestamp: string
  status: string
}

export type GetProgramCallsPaginatedParameters = {
  programId: string
  /** 1–50, defaults to 20 server-side. */
  limit?: number
  cursorBlockNumber?: number
  cursorTransitionId?: string
  direction?: 'next' | 'prev'
  sort?: 'asc' | 'desc'
}

export type GetProgramCallsPaginatedReturnType = {
  prev_cursor: ProgramCallsCursor | null
  next_cursor: ProgramCallsCursor | null
  calls: ProgramCall[]
}

export async function getProgramCallsPaginated(
  client: Client,
  params: GetProgramCallsPaginatedParameters,
): Promise<GetProgramCallsPaginatedReturnType> {
  return client.request({
    method: 'getProgramCallsPaginated',
    params: {
      programId: params.programId,
      limit: params.limit,
      cursorBlockNumber: params.cursorBlockNumber,
      cursorTransitionId: params.cursorTransitionId,
      direction: params.direction,
      sort: params.sort,
    },
  }) as Promise<GetProgramCallsPaginatedReturnType>
}
