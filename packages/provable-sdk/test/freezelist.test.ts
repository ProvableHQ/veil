import { beforeAll, describe, expect, it } from 'vitest'
import { loadNetwork } from '../src/index.js'

const ROOT = '3642222252059314292809609689035560016959342421640560347114299934615987159853field'
const address = 'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n'
const frozen = 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px'
let sdk: Awaited<ReturnType<typeof loadNetwork>>
beforeAll(async () => { sdk = await loadNetwork('testnet') }, 30_000)

describe('SDK freezelist witnesses', () => {
  it.each(['local', 'delegated'] as const)('exposes the generator on %s proving configs', async mode => {
    const config = sdk.createProvingConfig({ mode, networkUrl: 'https://node.example', account: sdk.generateAccount() })
    expect(await config.generateFreezelistProof!({ address, tree: [], root: ROOT }))
      .toBe(await sdk.generateFreezelistProof({ address, tree: [], root: ROOT }))
  })

  it('generates the contract empty-root witness in Node', async () => {
    const proof = await sdk.generateFreezelistProof({ address, tree: ['0', '0', ROOT.slice(0, -5)], root: ROOT })
    expect(proof.match(/0field/g)).toHaveLength(32)
    expect(proof.match(/leaf_index: 1u32/g)).toHaveLength(2)
    expect(await sdk.generateFreezelistProof({ address, tree: [], root: ROOT })).toBe(proof)
  })

  it('rejects a tree or witness that does not match the on-chain root', async () => {
    await expect(sdk.generateFreezelistProof({ address, tree: ['0', '0', '1'], root: ROOT })).rejects.toThrow(/root/i)
    await expect(sdk.generateFreezelistProof({ address, tree: [], root: '1field' })).rejects.toThrow(/root/i)
    await expect(sdk.generateFreezelistProof({ address, tree: ['0', '1'], root: ROOT })).rejects.toThrow(/tree/i)
  })

  it('rejects frozen subjects and tampered paths in a populated tree', async () => {
    const { SealanceMerkleTree } = await import('@provablehq/sdk/testnet.js')
    const merkle = new SealanceMerkleTree()
    const nodes = merkle.buildTree(merkle.generateLeaves([frozen], 16))
    const tree = nodes.map(String)
    const root = `${nodes.at(-1)}field`
    await expect(sdk.generateFreezelistProof({ address: frozen, tree, root })).rejects.toThrow(/frozen/i)
    const proof = await sdk.generateFreezelistProof({ address, tree, root })
    expect(proof).toContain(`${nodes[1]}field`)
    const tampered = [...tree]
    tampered[1] = '1'
    await expect(sdk.generateFreezelistProof({ address, tree: tampered, root })).rejects.toThrow(/root/i)
  })
})
