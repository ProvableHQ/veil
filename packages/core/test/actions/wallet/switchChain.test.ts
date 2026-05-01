import { describe, it, expect, vi } from 'vitest'
import { switchChain, switchNetwork } from '../../../src/actions/wallet/switchChain.js'

describe('switchChain', () => {
  it('calls client.request with switchNetwork method', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    const client = { request } as any

    await switchChain(client, { network: 'testnet' })
    expect(request).toHaveBeenCalledWith({
      method: 'switchNetwork',
      params: { network: 'testnet' },
    })
  })

  it('returns void', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    const client = { request } as any

    const result = await switchChain(client, { network: 'mainnet' })
    expect(result).toBeUndefined()
  })

  it('switchNetwork alias exports the same function', () => {
    expect(switchNetwork).toBe(switchChain)
  })
})
