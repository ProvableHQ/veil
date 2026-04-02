import { describe, it, expect, vi } from 'vitest'
import { getBlockNumber } from '../../../src/actions/public/getBlockNumber.js'

describe('getBlockNumber', () => {
  it('returns the latest height as bigint', async () => {
    const client = {
      request: vi.fn().mockResolvedValue(12345),
    } as any

    const result = await getBlockNumber(client)
    expect(result).toBe(12345n)
    expect(client.request).toHaveBeenCalledWith({ method: 'getLatestHeight' })
  })
})
