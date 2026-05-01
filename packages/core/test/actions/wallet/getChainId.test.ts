import { describe, it, expect, vi } from 'vitest'
import { getChainId } from '../../../src/actions/wallet/getChainId.js'

describe('getChainId', () => {
  it('calls client.request with getChainId method', async () => {
    const request = vi.fn().mockResolvedValue('testnet')
    const client = { request } as any

    await getChainId(client)
    expect(request).toHaveBeenCalledWith({
      method: 'getChainId',
      params: {},
    })
  })

  it('returns a string', async () => {
    const request = vi.fn().mockResolvedValue('mainnet')
    const client = { request } as any

    const result = await getChainId(client)
    expect(result).toBe('mainnet')
    expect(typeof result).toBe('string')
  })
})
