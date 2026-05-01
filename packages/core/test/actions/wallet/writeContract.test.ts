import { describe, it, expect, vi } from 'vitest'
import { writeContract, executeTransaction } from '../../../src/actions/wallet/writeContract.js'
import { AccountNotFoundError, ProvingNotConfiguredError } from '../../../src/errors/errors.js'

describe('writeContract', () => {
  const baseParams = {
    program: 'token.aleo',
    function: 'mint',
    inputs: ['aleo1abc', '100u64'],
  }

  it('throws AccountNotFoundError when no account', async () => {
    const client = { account: undefined, request: vi.fn() } as any
    await expect(writeContract(client, baseParams)).rejects.toThrow(AccountNotFoundError)
  })

  it('throws AccountNotFoundError when account has no sign', async () => {
    const client = { account: { type: 'viewOnly', address: 'aleo1abc' }, request: vi.fn() } as any
    await expect(writeContract(client, baseParams)).rejects.toThrow(AccountNotFoundError)
  })

  it('delegates to transport with correct params for RPC account', async () => {
    const request = vi.fn().mockResolvedValue('at1txid')
    const client = {
      account: { type: 'rpc', address: 'aleo1abc', sign: vi.fn() },
      request,
    } as any

    const result = await writeContract(client, baseParams)
    expect(result).toBe('at1txid')
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: {
        programName: 'token.aleo',
        functionName: 'mint',
        inputs: ['aleo1abc', '100u64'],
        privateFee: undefined,
        imports: undefined,
      },
    })
  })

  it('uses buildTransaction when proving config is present', async () => {
    const builtTx = { type: 'execute', id: 'at1built' }
    const buildTransaction = vi.fn().mockResolvedValue(builtTx)
    const request = vi.fn().mockResolvedValue('at1txid')
    const client = {
      account: { type: 'local', address: 'aleo1abc', sign: vi.fn() },
      proving: { buildTransaction },
      request,
    } as any

    const result = await writeContract(client, baseParams)
    expect(result).toBe('at1txid')
    expect(buildTransaction).toHaveBeenCalledWith({
      programName: 'token.aleo',
      functionName: 'mint',
      inputs: ['aleo1abc', '100u64'],
      privateFee: undefined,
      imports: undefined,
    })
    expect(request).toHaveBeenCalledWith({
      method: 'sendTransaction',
      params: { transaction: JSON.stringify(builtTx) },
    })
  })

  it('throws ProvingNotConfiguredError for local account without proving config', async () => {
    const client = {
      account: { type: 'local', address: 'aleo1abc', sign: vi.fn() },
      proving: undefined,
      request: vi.fn(),
    } as any
    await expect(writeContract(client, baseParams)).rejects.toThrow(ProvingNotConfiguredError)
  })

  it('executeTransaction is an alias for writeContract', () => {
    expect(executeTransaction).toBe(writeContract)
  })
})
