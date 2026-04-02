import { describe, it, expect, vi } from 'vitest'
import { getBlock } from '../../../src/actions/public/getBlock.js'

describe('getBlock', () => {
  it('fetches block by height', async () => {
    const mockBlock = { height: 100, hash: 'ab1234', transactions: [] }
    const client = {
      request: vi.fn().mockResolvedValue(mockBlock),
    } as any

    const result = await getBlock(client, { height: 100 })
    expect(result).toEqual(mockBlock)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getBlock',
      params: { height: 100 },
    })
  })

  it('fetches block by hash', async () => {
    const mockBlock = { height: 100, hash: 'ab1234', transactions: [] }
    const client = {
      request: vi.fn().mockResolvedValue(mockBlock),
    } as any

    const result = await getBlock(client, { hash: 'ab1234' })
    expect(result).toEqual(mockBlock)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getBlockByHash',
      params: { hash: 'ab1234' },
    })
  })
})
