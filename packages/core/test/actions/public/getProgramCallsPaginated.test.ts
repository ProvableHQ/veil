import { describe, it, expect, vi } from 'vitest'
import { getProgramCallsPaginated } from '../../../src/actions/public/getProgramCallsPaginated.js'

describe('getProgramCallsPaginated', () => {
  it('returns paginated calls payload', async () => {
    const payload = {
      prev_cursor: null,
      next_cursor: { block_number: 12345, transition_id: 'au1xyz' },
      calls: [
        {
          transaction_id: 'at1a',
          function_id: 'transfer',
          block_number: 12340,
          block_timestamp: '1700000000',
          status: 'accepted',
        },
      ],
    }
    const client = { request: vi.fn().mockResolvedValue(payload) } as any
    const result = await getProgramCallsPaginated(client, {
      programId: 'token.aleo',
      limit: 20,
      direction: 'next',
      sort: 'desc',
    })
    expect(result).toEqual(payload)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getProgramCallsPaginated',
      params: {
        programId: 'token.aleo',
        limit: 20,
        cursorBlockNumber: undefined,
        cursorTransitionId: undefined,
        direction: 'next',
        sort: 'desc',
      },
    })
  })

  it('passes cursor params through when supplied', async () => {
    const client = { request: vi.fn().mockResolvedValue({ prev_cursor: null, next_cursor: null, calls: [] }) } as any
    await getProgramCallsPaginated(client, {
      programId: 'token.aleo',
      cursorBlockNumber: 10000,
      cursorTransitionId: 'au1cursor',
    })
    expect(client.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'getProgramCallsPaginated',
        params: expect.objectContaining({
          cursorBlockNumber: 10000,
          cursorTransitionId: 'au1cursor',
        }),
      }),
    )
  })
})
