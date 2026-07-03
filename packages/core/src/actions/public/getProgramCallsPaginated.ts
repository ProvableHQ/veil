import type { Client } from '../../clients/createClient.js'

/**
 * Cursor marking a position in a program's call history.
 *
 * Pass its fields back as `cursorBlockNumber` and `cursorTransitionId` to
 * continue paging from this position.
 *
 * @property block_number Block height of the call at the cursor.
 * @property transition_id Transition ID (`au1…`) of the call at the cursor.
 */
export type ProgramCallsCursor = {
  block_number: number
  transition_id: string
}

/**
 * One call into a program, as listed in its call history.
 *
 * @property transaction_id Transaction (`at1…`) that carried the call.
 * @property function_id Function that was called.
 * @property block_number Block height the call landed in.
 * @property block_timestamp Unix-seconds timestamp as a string (API wire format).
 * @property status Transaction status reported by the endpoint: accepted or rejected.
 */
export type ProgramCall = {
  transaction_id: string
  function_id: string
  block_number: number
  block_timestamp: string
  status: string
}

/**
 * Parameters for {@link getProgramCallsPaginated}.
 *
 * @property programId Program whose call history to page through.
 * @property limit Page size, 1–50. Defaults to 20 server-side.
 * @property cursorBlockNumber Block height of the cursor to page from, taken
 *   from a previous page's `next_cursor` or `prev_cursor`. Omit both cursor
 *   fields to start from the newest calls.
 * @property cursorTransitionId Transition ID of the cursor to page from,
 *   paired with `cursorBlockNumber`.
 * @property direction Page forward (`'next'`) or backward (`'prev'`) from the
 *   cursor.
 * @property sort Block-height order of results within a page, `'asc'` or `'desc'`.
 */
export type GetProgramCallsPaginatedParameters = {
  programId: string
  limit?: number
  cursorBlockNumber?: number
  cursorTransitionId?: string
  direction?: 'next' | 'prev'
  sort?: 'asc' | 'desc'
}

/**
 * One page of a program's call history.
 *
 * @property prev_cursor Cursor for the preceding page, or `null` at the start
 *   of the history.
 * @property next_cursor Cursor for the following page, or `null` at the end.
 * @property calls Calls on this page.
 */
export type GetProgramCallsPaginatedReturnType = {
  prev_cursor: ProgramCallsCursor | null
  next_cursor: ProgramCallsCursor | null
  calls: ProgramCall[]
}

/**
 * Fetches one page of a program's call history with cursor pagination.
 *
 * Use this over `getProgramCalls` for typed results or more than the latest
 * feed. To fetch the following page, pass the returned
 * `next_cursor` fields back as `cursorBlockNumber` and `cursorTransitionId`.
 * Queries the connected node, so it hits the network.
 *
 * @param client Client whose transport serves the query.
 * @param params Program, page size, and cursor position.
 * @returns A page of calls with cursors for the neighboring pages.
 *
 * @example
 * const page = await client.getProgramCallsPaginated({ programId: 'credits.aleo', limit: 20 })
 * if (page.next_cursor) {
 *   const next = await client.getProgramCallsPaginated({
 *     programId: 'credits.aleo',
 *     cursorBlockNumber: page.next_cursor.block_number,
 *     cursorTransitionId: page.next_cursor.transition_id,
 *   })
 * }
 */
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
