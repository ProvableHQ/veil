import { describe, it, expect, vi } from 'vitest'
import { getLatestEdition } from '../../../src/actions/public/getLatestEdition.js'

describe('getLatestEdition', () => {
  it('returns the latest edition as a number', async () => {
    const client = { request: vi.fn().mockResolvedValue(7) } as any
    const result = await getLatestEdition(client, { programId: 'token.aleo' })
    expect(result).toBe(7)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getLatestEdition',
      params: { programId: 'token.aleo' },
    })
  })
})
