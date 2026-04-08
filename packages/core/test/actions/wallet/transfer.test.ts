import { describe, it, expect, vi } from 'vitest'
import { transfer } from '../../../src/actions/wallet/transfer.js'

function mockClient() {
  const request = vi.fn().mockResolvedValue('at1transfer')
  return {
    client: {
      account: { type: 'rpc', address: 'aleo1abc', sign: vi.fn() },
      request,
    } as any,
    request,
  }
}

describe('transfer', () => {
  it('defaults to public transfer on credits.aleo', async () => {
    const { client, request } = mockClient()

    const result = await transfer(client, { to: 'aleo1dest', amount: 5000000n })
    expect(result).toBe('at1transfer')
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'credits.aleo',
        functionName: 'transfer_public',
        inputs: ['aleo1dest', '5000000u64'],
        privateFee: false,
      }),
    })
  })

  it('visibility: private → transfer_private', async () => {
    const { client, request } = mockClient()

    await transfer(client, { to: 'aleo1dest', amount: 1000n, visibility: 'private' })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        functionName: 'transfer_private',
        privateFee: true,
      }),
    })
  })

  it('visibility: shield → transfer_public_to_private', async () => {
    const { client, request } = mockClient()

    await transfer(client, { to: 'aleo1dest', amount: 2000n, visibility: 'shield' })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        functionName: 'transfer_public_to_private',
        privateFee: false,
      }),
    })
  })

  it('visibility: unshield → transfer_private_to_public', async () => {
    const { client, request } = mockClient()

    await transfer(client, { to: 'aleo1dest', amount: 3000n, visibility: 'unshield' })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        functionName: 'transfer_private_to_public',
        privateFee: true,
      }),
    })
  })

  it('custom asset program', async () => {
    const { client, request } = mockClient()

    await transfer(client, {
      to: 'aleo1dest',
      amount: 500n,
      asset: 'my_token.aleo',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'my_token.aleo',
        functionName: 'transfer_public',
      }),
    })
  })

  it('custom asset + private visibility', async () => {
    const { client, request } = mockClient()

    await transfer(client, {
      to: 'aleo1dest',
      amount: 100n,
      asset: 'stablecoin.aleo',
      visibility: 'private',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'stablecoin.aleo',
        functionName: 'transfer_private',
        privateFee: true,
      }),
    })
  })

  it('encodes amount as u64', async () => {
    const { client, request } = mockClient()

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
