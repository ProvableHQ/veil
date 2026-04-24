import { describe, it, expect, vi } from 'vitest'
import { getStatePaths } from '../../../src/actions/public/getStatePaths.js'

describe('getStatePaths', () => {
  it('returns an array of state paths for the given commitments', async () => {
    const paths = ['path1', 'path2']
    const client = { request: vi.fn().mockResolvedValue(paths) } as any
    const result = await getStatePaths(client, { commitments: ['c1', 'c2'] })
    expect(result).toEqual(paths)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getStatePaths',
      params: { commitments: ['c1', 'c2'] },
    })
  })
})
