import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseProgram } from '../../../src/contract/parseProgram.js'
import { transfer } from '../../../src/actions/wallet/transfer.js'
import type { TransactionInput } from '../../../src/types/inputRequest.js'

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
  it.each(['private', 'unshield'] as const)('assembles an explicit ARC-22 record and wallet proof for %s', async (visibility) => {
    const { client, request } = mockClient()
    const record: TransactionInput = { type: 'record', program: 'token.aleo', recordname: 'Token', uid: 'token-1' }
    const merkleProof = { type: 'derived' as const, algorithm: 'program-freezelist-exclusion-proof' as const, args: { freezelistProgram: { type: 'string' as const, value: 'compliance.aleo' } } }
    await transfer(client, { asset: 'token.aleo', to: 'aleo1dest', amount: 100n, amountWidth: 'u128', visibility, record, merkleProof })
    expect(request).toHaveBeenCalledWith({ method: 'executeTransaction', params: expect.objectContaining({ inputs: ['aleo1dest', '100u128', record, merkleProof] }) })
    const deployed = parseProgram(readFileSync(new URL('../../fixtures/programs/test_usdcx_stablecoin.aleo', import.meta.url), 'utf8'))
    const functionName = visibility === 'private' ? 'transfer_private' : 'transfer_private_to_public'
    const abiInputs = deployed.functions.find((fn) => fn.name === functionName)!.inputs
    expect(abiInputs.map((input) => input.type)).toEqual(['address', 'u128', 'Token', '[MerkleProof; 2u32]'])
    const sent = request.mock.calls[0]![0].params.inputs
    expect(sent[abiInputs.findIndex((input) => input.type === 'Token')]).toBe(record)
    expect(sent[abiInputs.findIndex((input) => input.type === '[MerkleProof; 2u32]')]).toBe(merkleProof)
  })

  it('does not add a supplied record to a public transfer', async () => {
    const { client, request } = mockClient()
    await transfer(client, { to: 'aleo1dest', amount: 1n, record: 'record1...' })
    expect(request).toHaveBeenCalledWith({ method: 'executeTransaction', params: expect.objectContaining({ inputs: ['aleo1dest', '1u64'] }) })
  })

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

  it('amountWidth: u128 encodes the amount for token programs', async () => {
    const { client, request } = mockClient()

    await transfer(client, {
      asset: 'token_registry.aleo',
      to: 'aleo1dest',
      amount: 1_000_000n,
      visibility: 'unshield',
      amountWidth: 'u128',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'token_registry.aleo',
        functionName: 'transfer_private_to_public',
        inputs: ['aleo1dest', '1000000u128'],
        privateFee: true,
      }),
    })
  })

  it('appends merkleProof as the final input on unshield transfers', async () => {
    const { client, request } = mockClient()

    await transfer(client, {
      asset: 'usdcx_stablecoin.aleo',
      to: 'aleo1dest',
      amount: 100_000_000n,
      visibility: 'unshield',
      amountWidth: 'u128',
      merkleProof: 'mp-input',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'usdcx_stablecoin.aleo',
        functionName: 'transfer_private_to_public',
        inputs: ['aleo1dest', '100000000u128', 'mp-input'],
        privateFee: true,
      }),
    })
  })

  it('appends merkleProof on private transfers of any program the caller flags', async () => {
    // Core keeps no program allowlist — the caller owns the knowledge, so the
    // proof rides along for a program core has never heard of.
    const { client, request } = mockClient()

    await transfer(client, {
      asset: 'custom_compliance_token.aleo',
      to: 'aleo1dest',
      amount: 5n,
      visibility: 'private',
      amountWidth: 'u128',
      merkleProof: 'mp-input',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'custom_compliance_token.aleo',
        inputs: ['aleo1dest', '5u128', 'mp-input'],
      }),
    })
  })

  it('ignores merkleProof on public-side transfers, where programs take none', async () => {
    const { client, request } = mockClient()

    await transfer(client, {
      asset: 'usdcx_stablecoin.aleo',
      to: 'aleo1dest',
      amount: 7n,
      visibility: 'public',
      amountWidth: 'u128',
      merkleProof: 'mp-input',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        functionName: 'transfer_public',
        inputs: ['aleo1dest', '7u128'],
        privateFee: false,
      }),
    })
  })
})
