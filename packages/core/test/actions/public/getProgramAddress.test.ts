import { describe, it, expect, vi } from 'vitest'
import { getProgramAddress } from '../../../src/actions/public/getProgramAddress.js'

describe('getProgramAddress', () => {
  it('resolves a program ID to its on-chain address', async () => {
    const client = { request: vi.fn().mockResolvedValue('aleo1program') } as any
    const result = await getProgramAddress(client, { programId: 'token.aleo' })
    expect(result).toBe('aleo1program')
    expect(client.request).toHaveBeenCalledWith({
      method: 'getProgramAddress',
      params: { programId: 'token.aleo' },
    })
  })
})
