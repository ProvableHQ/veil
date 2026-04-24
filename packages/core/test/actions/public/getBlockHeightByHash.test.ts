import { describe, it, expect, vi } from 'vitest'
import { getBlockHeightByHash } from '../../../src/actions/public/getBlockHeightByHash.js'

describe('getBlockHeightByHash', () => {
  it('returns the height for a given block hash', async () => {
    const client = { request: vi.fn().mockResolvedValue(100) } as any
    const result = await getBlockHeightByHash(client, { hash: 'ab1xyz' })
    expect(result).toBe(100)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getBlockHeightByHash',
      params: { hash: 'ab1xyz' },
    })
  })
})
