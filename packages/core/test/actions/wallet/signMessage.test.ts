import { describe, it, expect, vi } from 'vitest'
import { signMessage } from '../../../src/actions/wallet/signMessage.js'
import { AccountNotFoundError } from '../../../src/errors/errors.js'

describe('signMessage', () => {
  it('throws AccountNotFoundError when no account', async () => {
    const client = { account: undefined, request: vi.fn() } as any
    await expect(
      signMessage(client, { message: new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow(AccountNotFoundError)
  })

  it('throws AccountNotFoundError when account has no signMessage', async () => {
    const client = { account: { type: 'rpc', address: 'aleo1abc' }, request: vi.fn() } as any
    await expect(
      signMessage(client, { message: new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow(AccountNotFoundError)
  })

  it('delegates to account.signMessage', async () => {
    const signature = new Uint8Array([4, 5, 6])
    const mockSignMessage = vi.fn().mockResolvedValue(signature)
    const client = {
      account: { type: 'local', address: 'aleo1abc', signMessage: mockSignMessage },
      request: vi.fn(),
    } as any

    const result = await signMessage(client, { message: new Uint8Array([1, 2, 3]) })
    expect(result).toEqual(signature)
    expect(mockSignMessage).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]))
  })
})
