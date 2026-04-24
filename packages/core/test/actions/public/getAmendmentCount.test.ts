import { describe, it, expect, vi } from 'vitest'
import { getAmendmentCount } from '../../../src/actions/public/getAmendmentCount.js'

describe('getAmendmentCount', () => {
  it('returns amendment count payload for current edition', async () => {
    const payload = { program_id: 'token.aleo', edition: 3, amendment_count: 2 }
    const client = { request: vi.fn().mockResolvedValue(payload) } as any
    const result = await getAmendmentCount(client, { programId: 'token.aleo' })
    expect(result).toEqual(payload)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getAmendmentCount',
      params: { programId: 'token.aleo' },
    })
  })
})
