import { describe, it, expect, vi } from 'vitest'
import { getProgramIdByAddress } from '../../../src/actions/public/getProgramIdByAddress.js'

describe('getProgramIdByAddress', () => {
  it('resolves a program address to its program ID', async () => {
    const client = { request: vi.fn().mockResolvedValue('token.aleo') } as any
    const result = await getProgramIdByAddress(client, { address: 'aleo1program' })
    expect(result).toBe('token.aleo')
    expect(client.request).toHaveBeenCalledWith({
      method: 'getProgramIdByAddress',
      params: { address: 'aleo1program' },
    })
  })
})
