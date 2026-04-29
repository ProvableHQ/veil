import { describe, it, expect, vi } from 'vitest'
import { executeContract } from '../../../src/actions/wallet/executeContract.js'
import { AccountNotFoundError, ProvingNotConfiguredError } from '../../../src/errors/errors.js'

describe('executeContract', () => {
  const baseParams = {
    program: 'token.aleo',
    function: 'mint',
    inputs: ['aleo1abc', '100u64'],
    fee: 1000n,
  }

  it('throws AccountNotFoundError when no account', async () => {
    const client = { account: undefined, request: vi.fn() } as any
    await expect(executeContract(client, baseParams)).rejects.toThrow(AccountNotFoundError)
  })

  it('throws AccountNotFoundError when account has no sign', async () => {
    const client = { account: { type: 'viewOnly', address: 'aleo1abc' }, request: vi.fn() } as any
    await expect(executeContract(client, baseParams)).rejects.toThrow(AccountNotFoundError)
  })

  it('delegates to transport for RPC account', async () => {
    const request = vi.fn().mockResolvedValue({ transactionId: 'at1rpc', outputs: ['100u64'] })
    const client = {
      account: { type: 'rpc', address: 'aleo1abc', sign: vi.fn() },
      request,
    } as any

    const result = await executeContract(client, baseParams)
    expect(result).toEqual({ transactionId: 'at1rpc', outputs: ['100u64'] })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: {
        programName: 'token.aleo',
        functionName: 'mint',
        inputs: ['aleo1abc', '100u64'],
        fee: 1000n,
        programSource: undefined,
        imports: undefined,
      },
    })
  })

  it('calls proving.execute for local account with execute configured', async () => {
    const execute = vi.fn().mockResolvedValue({ transactionId: 'at1local', outputs: ['200u64'] })
    const client = {
      account: { type: 'local', address: 'aleo1abc', sign: vi.fn() },
      proving: { execute },
      request: vi.fn(),
    } as any

    const result = await executeContract(client, baseParams)
    expect(result).toEqual({ transactionId: 'at1local', outputs: ['200u64'] })
    expect(execute).toHaveBeenCalledWith({
      programName: 'token.aleo',
      functionName: 'mint',
      inputs: ['aleo1abc', '100u64'],
      fee: 1000n,
      privateFee: undefined,
      programSource: undefined,
      programImports: undefined,
    })
  })

  it('throws ProvingNotConfiguredError when execute is not available (no silent fallback)', async () => {
    const client = {
      account: { type: 'local', address: 'aleo1abc', sign: vi.fn() },
      proving: { simulate: vi.fn() }, // simulate exists but execute does not
      request: vi.fn(),
    } as any

    await expect(executeContract(client, baseParams)).rejects.toThrow(ProvingNotConfiguredError)
  })

  it('throws ProvingNotConfiguredError when proving config is undefined', async () => {
    const client = {
      account: { type: 'local', address: 'aleo1abc', sign: vi.fn() },
      proving: undefined,
      request: vi.fn(),
    } as any

    await expect(executeContract(client, baseParams)).rejects.toThrow(ProvingNotConfiguredError)
  })

  it('passes programSource and imports through to proving.execute', async () => {
    const execute = vi.fn().mockResolvedValue({ transactionId: 'at1x', outputs: [] })
    const client = {
      account: { type: 'local', address: 'aleo1abc', sign: vi.fn() },
      proving: { execute },
      request: vi.fn(),
    } as any

    await executeContract(client, {
      ...baseParams,
      programSource: 'program token.aleo;',
      imports: { 'credits.aleo': 'program credits.aleo;' },
    })

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      programSource: 'program token.aleo;',
      programImports: { 'credits.aleo': 'program credits.aleo;' },
    }))
  })

  it('uses default fee of 0n when fee is not provided', async () => {
    const execute = vi.fn().mockResolvedValue({ transactionId: 'at1x', outputs: [] })
    const client = {
      account: { type: 'local', address: 'aleo1abc', sign: vi.fn() },
      proving: { execute },
      request: vi.fn(),
    } as any

    await executeContract(client, {
      program: 'token.aleo',
      function: 'mint',
      inputs: [],
      // no fee
    })

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      fee: 0n,
    }))
  })
})
