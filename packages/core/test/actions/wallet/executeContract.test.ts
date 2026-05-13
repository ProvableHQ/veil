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

  it('RPC: submits via wallet, polls for confirmation, returns RawExecuteResult', async () => {
    // Wallet's executeTransaction returns just the tx id. The SDK then polls
    // getConfirmedTransaction itself and walks the transitions.
    const request = vi.fn().mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'executeTransaction') return 'at1submitted'
      if (method === 'getConfirmedTransaction') return {
        status: 'accepted',
        type: 'execute',
        index: 0,
        finalize: [],
        transaction: {
          execution: {
            transitions: [
              {
                id: 'au1outer',
                program: 'token.aleo',
                function: 'mint',
                outputs: [{ value: '100u64', type: 'public' }],
              },
            ],
          },
        },
      }
      throw new Error(`Unexpected method: ${method}`)
    })
    const client = {
      account: { type: 'rpc', address: 'aleo1abc', sign: vi.fn() },
      request,
    } as any

    const result = await executeContract(client, baseParams)

    expect(result.transactionId).toBe('at1submitted')
    expect(result.transitions).toHaveLength(1)
    expect(result.transitions[0]!.transitionId).toBe('au1outer')
    expect(result.transitions[0]!.outputs).toEqual(['100u64'])
    expect(result.outputs).toEqual(['100u64'])

    // Two RPC roundtrips: submit, then poll.
    expect(request).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenNthCalledWith(1, {
      method: 'executeTransaction',
      params: {
        programName: 'token.aleo',
        functionName: 'mint',
        inputs: ['aleo1abc', '100u64'],
        privateFee: undefined,
        imports: undefined,
      },
    })
    expect(request).toHaveBeenNthCalledWith(2, {
      method: 'getConfirmedTransaction',
      params: { id: 'at1submitted' },
    })
  })

  it('RPC: forwards wallet-adapter param shape (privateFee + imports as string[], no fee/programSource)', async () => {
    const request = vi.fn().mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'executeTransaction') return 'at1submitted'
      if (method === 'getConfirmedTransaction') return {
        status: 'accepted', type: 'execute', index: 0, finalize: [],
        transaction: { execution: { transitions: [] } },
      }
      throw new Error(`Unexpected method: ${method}`)
    })
    const client = {
      account: { type: 'rpc', address: 'aleo1abc', sign: vi.fn() },
      request,
    } as any

    await executeContract(client, {
      ...baseParams,
      privateFee: true,
      programSource: 'program token.aleo;',         // not forwarded — wallet has its own resolution
      imports: { 'credits.aleo': 'program credits.aleo;' },
    })

    expect(request).toHaveBeenNthCalledWith(1, {
      method: 'executeTransaction',
      params: {
        programName: 'token.aleo',
        functionName: 'mint',
        inputs: ['aleo1abc', '100u64'],
        privateFee: true,
        imports: ['credits.aleo'],   // Record<string,string> → string[] of keys
      },
    })
  })

  it('RPC: record ciphertexts pass through as raw strings (no decryption)', async () => {
    // RPC path intentionally doesn't ask the wallet to decrypt — record outputs
    // surface as `record1...` ciphertexts. The dApp's contract proxy can decide
    // what to do with them.
    const request = vi.fn().mockImplementation(async ({ method }: { method: string }) => {
      if (method === 'executeTransaction') return 'at1submitted'
      if (method === 'getConfirmedTransaction') return {
        status: 'accepted', type: 'execute', index: 0, finalize: [],
        transaction: {
          execution: {
            transitions: [
              {
                id: 'au1outer',
                program: 'token.aleo',
                function: 'mint',
                outputs: [
                  { value: 'record1abc...', type: 'record' },
                  { value: '42field', type: 'public' },
                ],
              },
            ],
          },
        },
      }
      throw new Error(`Unexpected method: ${method}`)
    })
    const client = {
      account: { type: 'rpc', address: 'aleo1abc', sign: vi.fn() },
      request,
    } as any

    const result = await executeContract(client, baseParams)

    expect(result.outputs).toEqual(['record1abc...', '42field'])
    // The dApp should NOT see a wallet.decrypt call — that permission boundary
    // stays inside the wallet.
    const methods = request.mock.calls.map(([req]) => req.method)
    expect(methods).not.toContain('decrypt')
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
