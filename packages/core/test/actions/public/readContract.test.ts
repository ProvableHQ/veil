import { describe, it, expect, vi } from 'vitest'
import { readContract } from '../../../src/actions/public/readContract.js'

describe('readContract', () => {
  it('reads a program mapping value', async () => {
    const client = {
      request: vi.fn().mockResolvedValue('100u64'),
    } as any

    const result = await readContract(client, {
      program: 'credits.aleo',
      mapping: 'account',
      key: 'aleo1abc',
    })

    expect(result).toBe('100u64')
    expect(client.request).toHaveBeenCalledWith({
      method: 'getMappingValue',
      params: { programId: 'credits.aleo', mapping: 'account', key: 'aleo1abc' },
    })
  })
})
