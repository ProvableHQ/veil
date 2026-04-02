import { describe, it, expect, vi } from 'vitest'
import { getTransaction } from '../../../src/actions/public/getTransaction.js'

describe('getTransaction', () => {
  it('fetches transaction by ID', async () => {
    const mockTx = { id: 'at1abc', status: 'accepted', transitions: [] }
    const client = {
      request: vi.fn().mockResolvedValue(mockTx),
    } as any

    const result = await getTransaction(client, { id: 'at1abc' })
    expect(result).toEqual(mockTx)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getTransaction',
      params: { id: 'at1abc' },
    })
  })
})
