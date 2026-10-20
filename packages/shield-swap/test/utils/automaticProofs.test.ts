import { describe, expect, it, vi } from 'vitest'
import { createClient, isFreezelistProofRequest, type Client } from '@provablehq/veil-core'
import { resolveActionProofs, ammProofContext, wrapperProofContext } from '../../src/utils/resolveProofs.js'

function local() {
  let root = '123field'
  const request = vi.fn(async ({ method }: { method: string }) => method === 'getMappingValue' ? root : ['0', '0', root.slice(0, -5)])
  const generate = vi.fn(async ({ address, root }: { address: string; root: string }) => `${address}:${root}`)
  const client = createClient({
    account: { type: 'local', address: 'aleo1signer' } as Client['account'],
    transport: { request, config: { key: 'test', name: 'test', type: 'test', request, network: 'testnet' } },
    proving: { generateFreezelistProof: generate } as unknown as Client['proving'],
  })
  return { client, request, generate, change: () => { root = '456field' } }
}
const contexts = [ammProofContext('aleo1a'), ammProofContext('aleo1b'), ammProofContext('aleo1a')]

describe('automatic freezelist proofs', () => {
  it('pins one root per action, shares trees and witnesses, and invalidates on root changes', async () => {
    const { client, request, generate, change } = local()
    expect(await resolveActionProofs(client, undefined, contexts)).toEqual(['aleo1a:123field', 'aleo1b:123field', 'aleo1a:123field'])
    expect(request.mock.calls.map(([p]) => p.method)).toEqual(['getMappingValue', 'getComplianceFreezeList'])
    expect(generate).toHaveBeenCalledTimes(2)
    await resolveActionProofs(client, null, contexts)
    expect(request).toHaveBeenCalledTimes(3)
    expect(generate).toHaveBeenCalledTimes(2)
    change()
    await resolveActionProofs(client, undefined, contexts)
    expect(request).toHaveBeenCalledTimes(5)
    expect(generate).toHaveBeenCalledTimes(4)
  })

  it('does not cache failures or reuse another client cache', async () => {
    const { client, request, generate } = local()
    generate.mockRejectedValueOnce(new Error('stale tree'))
    await expect(resolveActionProofs(client, undefined, contexts.slice(0, 1))).rejects.toThrow('stale tree')
    await resolveActionProofs(client, undefined, contexts.slice(0, 1))
    expect(request.mock.calls.filter(([p]) => p.method === 'getComplianceFreezeList')).toHaveLength(2)
    const other = local()
    await resolveActionProofs(other.client, undefined, contexts)
    expect(other.generate).toHaveBeenCalledTimes(2)
  })

  it('shares concurrent downloads and separates network scopes', async () => {
    const { client, request, generate } = local()
    await Promise.all([resolveActionProofs(client, undefined, contexts), resolveActionProofs(client, undefined, contexts)])
    expect(request.mock.calls.filter(([p]) => p.method === 'getMappingValue')).toHaveLength(2)
    expect(request.mock.calls.filter(([p]) => p.method === 'getComplianceFreezeList')).toHaveLength(1)
    expect(generate).toHaveBeenCalledTimes(2)
    client.transport.config.network = 'mainnet'
    await resolveActionProofs(client, undefined, contexts)
    expect(request.mock.calls.filter(([p]) => p.method === 'getComplianceFreezeList')).toHaveLength(2)
    expect(generate).toHaveBeenCalledTimes(4)
  })

  it('accepts strings, bounded tuples, annotated proofs and old providers without fetching', async () => {
    const { client, request } = local()
    expect(await resolveActionProofs(client, 'proof', contexts.slice(0, 1))).toEqual(['proof'])
    expect(await resolveActionProofs(client, ['a', 'b', 'c'], contexts)).toEqual(['a', 'b', 'c'])
    expect(await resolveActionProofs(client, [{ freezelistProgram: 'shield_swap_freezelist.aleo', address: 'aleo1a', proof: 'cached' }], [contexts[0]!])).toEqual(['cached'])
    expect(await resolveActionProofs(client, async () => 'provider', contexts)).toEqual(['provider', 'provider', 'provider'])
    await expect(resolveActionProofs(client, ['a'], contexts)).rejects.toThrow('requires 3')
    expect(request).not.toHaveBeenCalled()
  })

  it('derives wallet requests and recognizes only known underlying lists or explicit overrides', async () => {
    const { client, request } = local()
    client.account = { type: 'rpc', address: 'aleo1signer' } as Client['account']
    const route = { wrapped: true as const, tokenId: '1field', underlyingId: '2field', wrapperProgram: 'wrap.aleo', underlyingProgram: 'usdcx_stablecoin.aleo' }
    const values = await resolveActionProofs(client, undefined, [ammProofContext('aleo1signer', true), wrapperProofContext(route, 'aleo1recipient', false)])
    expect(values.every(isFreezelistProofRequest)).toBe(true)
    expect(values[1]).toMatchObject({ args: { freezelistProgram: { value: 'usdcx_freezelist.aleo' }, address: { value: 'aleo1recipient' } } })
    await expect(resolveActionProofs(client, undefined, [wrapperProofContext({ ...route, underlyingProgram: 'custom.aleo' }, 'aleo1a')])).rejects.toThrow('No freezelist configured')
    expect(request).not.toHaveBeenCalled()
  })
})
