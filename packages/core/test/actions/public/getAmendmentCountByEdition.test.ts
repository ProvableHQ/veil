import { describe, it, expect, vi } from 'vitest'
import { getAmendmentCountByEdition } from '../../../src/actions/public/getAmendmentCountByEdition.js'

describe('getAmendmentCountByEdition', () => {
  it('returns amendment count payload for a specific edition', async () => {
    const payload = { program_id: 'token.aleo', edition: 2, amendment_count: 5 }
    const client = { request: vi.fn().mockResolvedValue(payload) } as any
    const result = await getAmendmentCountByEdition(client, { programId: 'token.aleo', edition: 2 })
    expect(result).toEqual(payload)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getAmendmentCountByEdition',
      params: { programId: 'token.aleo', edition: 2 },
    })
  })
})
