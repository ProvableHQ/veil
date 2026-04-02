import { describe, it, expect, vi } from 'vitest'
import { requestRecords } from '../../../src/actions/wallet/requestRecords.js'
import { AccountNotFoundError } from '../../../src/errors/errors.js'

describe('requestRecords', () => {
  it('delegates to transport', async () => {
    const mockRecords = [{ owner: 'aleo1abc', data: {}, nonce: '1', programId: 'token.aleo', plaintext: '' }]
    const request = vi.fn().mockResolvedValue(mockRecords)
    const client = {
      account: { type: 'rpc', address: 'aleo1abc' },
      request,
    } as any

    const result = await requestRecords(client, { program: 'token.aleo' })
    expect(result).toEqual(mockRecords)
    expect(request).toHaveBeenCalledWith({
      method: 'requestRecords',
      params: { program: 'token.aleo' },
    })
  })

  it('throws without account', async () => {
    const client = { account: undefined, request: vi.fn() } as any
    await expect(requestRecords(client, { program: 'token.aleo' })).rejects.toThrow(AccountNotFoundError)
  })
})
