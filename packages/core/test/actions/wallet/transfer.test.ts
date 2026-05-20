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

describe('transfer — token_registry.aleo', () => {
  it('emits u128 amount and uses token_registry.aleo program', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 1000n,
      asset: 'token_registry.aleo',
      visibility: 'unshield',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'token_registry.aleo',
        functionName: 'transfer_private_to_public',
        inputs: ['aleo1dest', '1000u128'],
        privateFee: true,
      }),
    })
  })

  it('shield path emits u128 and uses transfer_public_to_private', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 500n,
      asset: 'token_registry.aleo',
      visibility: 'shield',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'token_registry.aleo',
        functionName: 'transfer_public_to_private',
        inputs: ['aleo1dest', '500u128'],
        privateFee: false,
      }),
    })
  })
})

describe('transfer — usdcx_stablecoin.aleo', () => {
  it('private mode appends merkleProof input', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 250n,
      asset: 'usdcx_stablecoin.aleo',
      visibility: 'private',
      merkleProof: '[ {} , {} ]',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'usdcx_stablecoin.aleo',
        functionName: 'transfer_private',
        inputs: ['aleo1dest', '250u128', '[ {} , {} ]'],
        privateFee: true,
      }),
    })
  })

  it('unshield mode appends merkleProof input', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 1n,
      asset: 'usdcx_stablecoin.aleo',
      visibility: 'unshield',
      merkleProof: 'mp-input',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'usdcx_stablecoin.aleo',
        functionName: 'transfer_private_to_public',
        inputs: ['aleo1dest', '1u128', 'mp-input'],
        privateFee: true,
      }),
    })
  })

  it('public mode does NOT append merkleProof', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 1n,
      asset: 'usdcx_stablecoin.aleo',
      visibility: 'public',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'usdcx_stablecoin.aleo',
        functionName: 'transfer_public',
        inputs: ['aleo1dest', '1u128'],
        privateFee: false,
      }),
    })
  })

  it('throws when merkleProof is missing for unshield', async () => {
    const { client } = mockClient()
    await expect(
      transfer(client, {
        to: 'aleo1dest',
        amount: 1n,
        asset: 'usdcx_stablecoin.aleo',
        visibility: 'unshield',
      }),
    ).rejects.toThrow(/merkleProof/)
  })
})

describe('transfer — usad_stablecoin.aleo', () => {
  it('private mode appends merkleProof and uses u128 width', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 42n,
      asset: 'usad_stablecoin.aleo',
      visibility: 'private',
      merkleProof: 'mp',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'usad_stablecoin.aleo',
        functionName: 'transfer_private',
        inputs: ['aleo1dest', '42u128', 'mp'],
        privateFee: true,
      }),
    })
  })
})

describe('transfer — escape hatches', () => {
  it('inputs override is passed verbatim and bypasses asset-derived inputs', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 1n,
      asset: 'custom.aleo',
      visibility: 'private',
      inputs: ['arg0', 'arg1', 'arg2'],
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'custom.aleo',
        functionName: 'transfer_private',
        inputs: ['arg0', 'arg1', 'arg2'],
      }),
    })
  })

  it('function override is passed verbatim', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 100n,
      function: 'transfer_public_as_signer',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        functionName: 'transfer_public_as_signer',
      }),
    })
  })

  it('amountWidth override forces u128 on credits.aleo', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 1n,
      amountWidth: 'u128',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        inputs: ['aleo1dest', '1u128'],
      }),
    })
  })

  it('privateFee override forces true on public transfer', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 1n,
      privateFee: true,
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        functionName: 'transfer_public',
        privateFee: true,
      }),
    })
  })
})
