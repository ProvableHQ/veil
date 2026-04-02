import { describe, it, expect, vi } from 'vitest'
import { rpcAccount } from '../../src/accounts/rpcAccount.js'

describe('rpcAccount', () => {
  it('creates an RpcAccount from a provider', () => {
    const provider = {
      address: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
      sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      signMessage: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
    }
    const account = rpcAccount(provider)

    expect(account.type).toBe('rpc')
    expect(account.address).toBe(provider.address)
  })

  it('delegates sign to the provider', async () => {
    const provider = {
      address: 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc',
      sign: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      signMessage: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
    }
    const account = rpcAccount(provider)
    const msg = new Uint8Array([7, 8, 9])
    await account.signMessage(msg)

    expect(provider.signMessage).toHaveBeenCalledWith(msg)
  })
})
