import { describe, it, expect, vi } from 'vitest'
import { transfer } from '../../../src/actions/wallet/transfer.js'

describe('transfer', () => {
  it('calls writeContract with credits.aleo/transfer_public', async () => {
    const request = vi.fn().mockResolvedValue('at1transfer')
    const client = {
      account: { type: 'rpc', address: 'aleo1abc', sign: vi.fn() },
      request,
    } as any

    const result = await transfer(client, { to: 'aleo1dest', amount: 5000000n })
    expect(result).toBe('at1transfer')
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: {
        programName: 'credits.aleo',
        functionName: 'transfer_public',
        inputs: ['aleo1dest', '5000000u64'],
        fee: 0n,
        privateFee: undefined,
      },
    })
  })

  it('uses transfer_private when privateFee is true', async () => {
    const request = vi.fn().mockResolvedValue('at1transfer')
    const client = {
      account: { type: 'rpc', address: 'aleo1abc', sign: vi.fn() },
      request,
    } as any

    await transfer(client, { to: 'aleo1dest', amount: 1000n, privateFee: true })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: {
        programName: 'credits.aleo',
        functionName: 'transfer_private',
        inputs: ['aleo1dest', '1000u64'],
        fee: 0n,
        privateFee: true,
      },
    })
  })

  it('encodes amount as u64', async () => {
    const request = vi.fn().mockResolvedValue('at1transfer')
    const client = {
      account: { type: 'rpc', address: 'aleo1abc', sign: vi.fn() },
      request,
    } as any

    await transfer(client, { to: 'aleo1dest', amount: 18446744073709551615n })
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          inputs: ['aleo1dest', '18446744073709551615u64'],
        }),
      }),
    )
  })
})
