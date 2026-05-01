import { describe, it, expect, vi } from 'vitest'
import { deployContract } from '../../../src/actions/wallet/deployContract.js'
import { AccountNotFoundError, ProvingNotConfiguredError } from '../../../src/errors/errors.js'

describe('deployContract', () => {
  it('throws AccountNotFoundError when no account', async () => {
    const client = { account: undefined, request: vi.fn() } as any
    await expect(
      deployContract(client, { program: 'token.aleo', fee: 1000n }),
    ).rejects.toThrow(AccountNotFoundError)
  })

  it('RPC account — delegates to wallet via transport', async () => {
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

  it('local account — builds deployment then broadcasts', async () => {
    const builtTx = { type: 'deploy', id: 'at1built' }
    const buildDeployment = vi.fn().mockResolvedValue(builtTx)
    const request = vi.fn().mockResolvedValue('at1deployed')
    const client = {
      account: { type: 'local', address: 'aleo1abc', sign: vi.fn() },
      proving: { buildDeployment },
      request,
    } as any

    const result = await deployContract(client, { program: 'program my_program.aleo;', fee: 10000n })
    expect(result).toBe('at1deployed')
    expect(buildDeployment).toHaveBeenCalledWith({
      program: 'program my_program.aleo;',
      fee: 10000n,
    })
    expect(request).toHaveBeenCalledWith({
      method: 'sendTransaction',
      params: { transaction: JSON.stringify(builtTx) },
    })
  })

  it('local account without buildDeployment throws ProvingNotConfiguredError', async () => {
    const client = {
      account: { type: 'local', address: 'aleo1abc', sign: vi.fn() },
      proving: undefined,
      request: vi.fn(),
    } as any
    await expect(
      deployContract(client, { program: 'test.aleo', fee: 1000n }),
    ).rejects.toThrow(ProvingNotConfiguredError)
  })
})
