import { describe, it, expect, vi } from 'vitest'
import { deployContract } from '../../../src/actions/wallet/deployContract.js'
import { AccountNotFoundError } from '../../../src/errors/errors.js'

describe('deployContract', () => {
  it('throws AccountNotFoundError when no account', async () => {
    const client = { account: undefined, request: vi.fn() } as any
    await expect(
      deployContract(client, { program: 'token.aleo', fee: 1000n }),
    ).rejects.toThrow(AccountNotFoundError)
  })

  it('delegates to transport with program and fee', async () => {
    const request = vi.fn().mockResolvedValue('at1deploy')
    const client = {
      account: { type: 'rpc', address: 'aleo1abc', sign: vi.fn() },
      request,
    } as any

    const result = await deployContract(client, { program: 'program token.aleo; ...', fee: 5000n })
    expect(result).toBe('at1deploy')
    expect(request).toHaveBeenCalledWith({
      method: 'deployProgram',
      params: { program: 'program token.aleo; ...', fee: 5000n },
    })
  })
})
