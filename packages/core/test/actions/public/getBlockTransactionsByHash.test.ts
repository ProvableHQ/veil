import { describe, it, expect, vi } from 'vitest'
import { getBlockTransactionsByHash } from '../../../src/actions/public/getBlockTransactionsByHash.js'

describe('getBlockTransactionsByHash', () => {
  it('returns the transactions payload for a block hash', async () => {
    const payload = {
      transactions: [
        {
          id: 'at1tx',
          fee: 1000,
          status: 'accepted',
          block_height: 50,
          block_timestamp: '1700000000',
          block_hash: 'ab1block',
          transaction_type: 'execute',
          program_id: 'token.aleo',
          function_id: 'transfer',
        },
      ],
    }
    const client = { request: vi.fn().mockResolvedValue(payload) } as any
    const result = await getBlockTransactionsByHash(client, { hash: 'ab1block' })
    expect(result).toEqual(payload)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getBlockTransactionsByHash',
      params: { hash: 'ab1block' },
    })
  })
})
