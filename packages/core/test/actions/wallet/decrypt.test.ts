import { describe, it, expect, vi } from 'vitest'
import { decrypt } from '../../../src/actions/wallet/decrypt.js'
import { AccountNotFoundError } from '../../../src/errors/errors.js'

describe('decrypt', () => {
  it('delegates to transport with params', async () => {
    const request = vi.fn().mockResolvedValue('{ owner: aleo1..., data: {} }')
    const client = {
      account: { type: 'rpc', address: 'aleo1abc' },
      request,
    } as any

    const result = await decrypt(client, { ciphertext: 'record1cipher...' })
    expect(result).toBe('{ owner: aleo1..., data: {} }')
    expect(request).toHaveBeenCalledWith({
      method: 'decrypt',
      params: { ciphertext: 'record1cipher...' },
    })
  })

  it('throws without account', async () => {
    const client = { account: undefined, request: vi.fn() } as any
    await expect(decrypt(client, { ciphertext: 'test' })).rejects.toThrow(AccountNotFoundError)
  })
})
