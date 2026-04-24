import { describe, it, expect, vi } from 'vitest'
import { getProgramByEdition } from '../../../src/actions/public/getProgramByEdition.js'

describe('getProgramByEdition', () => {
  it('returns program source at the given edition', async () => {
    const source = 'program token.aleo; ...'
    const client = { request: vi.fn().mockResolvedValue(source) } as any
    const result = await getProgramByEdition(client, { programId: 'token.aleo', edition: 3 })
    expect(result).toBe(source)
    expect(client.request).toHaveBeenCalledWith({
      method: 'getProgramByEdition',
      params: { programId: 'token.aleo', edition: 3 },
    })
  })
})
