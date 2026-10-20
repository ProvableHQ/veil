import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, executeContract, type Client, type Transport } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { swap } from '../../src/actions/swap/swap.js'
import { swapMultiHop } from '../../src/actions/swap/swapMultiHop.js'
import { claimSwapOutput } from '../../src/actions/swap/claimSwapOutput.js'
import { clearRouteCache, programToTokenId } from '../../src/utils/routing.js'

vi.mock('@provablehq/veil-core', async importOriginal => ({
  ...await importOriginal<typeof import('@provablehq/veil-core')>(),
  executeContract: vi.fn(),
}))

// Only chain state and transaction submission are fixtures. Proof generation
// uses the real testnet SDK and populated ARC-22 trees.
const frozen = [
  'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px',
  'aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n',
]
const allowed = 'aleo1gs50um2lczg83vxwng28y6aa4tpl46xgw4vw0yxy69exwztutqrskluww2'
const ammList = 'shield_swap_freezelist.aleo'
const tokenList = 'test_usdcx_freezelist.aleo'
const wrapper = 'wrapped_usdcx.aleo'
const wrappedId = programToTokenId(wrapper)
const plainId = programToTokenId('test_token_a.aleo')
const otherId = programToTokenId('test_token_b.aleo')
const freezelists = { wrapperFreezelists: { [wrapper]: tokenList } }
const slot = '{ tick: 0i32, tick_spacing: 60u32, sqrt_price: { hi: 1u128, lo: 0u128 }, fee_protocol: 0u8, liquidity: 94217047056u128, fee_growth_global0_x_128: { hi: 0u128, lo: 0u128 }, fee_growth_global1_x_128: { hi: 0u128, lo: 0u128 }, max_liquidity_per_tick: 9223372036854775808u128, protocol_fees0: 0u128, protocol_fees1: 0u128, next_init_below: -60i32, next_init_above: 60i32 }'
const identity = { blindingFactor: '1field', blindedAddress: allowed }
const intent = {
  tokenInId: wrappedId, amountIn: 100n, expectedOut: 90n,
  tokenRecord: 'record fixture', blindedIdentity: identity, imports: {}, freezelists,
}
let sdk: Awaited<ReturnType<typeof loadNetwork>>
let populated: { root: string; tree: string[] }
let empty: typeof populated

beforeAll(async () => {
  sdk = await loadNetwork('testnet')
  const { SealanceMerkleTree } = await import('@provablehq/sdk/testnet.js')
  const merkle = new SealanceMerkleTree()
  const snapshot = (addresses: string[]) => {
    const nodes = merkle.buildTree(merkle.generateLeaves(addresses, 16))
    return { root: `${nodes.at(-1)}field`, tree: nodes.map(String) }
  }
  populated = snapshot(frozen)
  empty = snapshot([])
}, 30_000)

beforeEach(() => {
  clearRouteCache()
  vi.mocked(executeContract).mockReset().mockResolvedValue({ transactionId: 'at1fixture', outputs: ['3field'], transitions: [] })
})

function client(address: string, frozenList: string, output = plainId, remainder = 0n): Client {
  const request: Transport['request'] = async ({ method, params }) => {
    const p = params as { programId?: string; mapping?: string; key?: string } | undefined
    const list = p?.programId === frozenList ? populated : empty
    if (method === 'getComplianceFreezeList') return list.tree
    if (method === 'getLatestHeight') return 1000n
    if (method !== 'getMappingValue') throw new Error(`Unexpected request: ${method}`)
    if (p?.mapping === 'freeze_list_root') return list.root
    if (p?.mapping === 'slots') return slot
    if (p?.mapping === 'pools') return p.key === '2field'
      ? `{ token0: ${plainId}, token1: ${otherId}, fee: 3000u16, enabled: true }`
      : `{ token0: ${wrappedId}, token1: ${plainId}, fee: 3000u16, enabled: true }`
    if (p?.mapping === 'from_wrapper_token_id') return p.key === wrappedId
      ? programToTokenId('test_usdcx_stablecoin.aleo') : null
    if (p?.mapping === 'swap_outputs') return `{ recipient: ${allowed}, caller: ${allowed}, token_in: ${wrappedId}, token_out: ${output}, amount_out: 90u128, amount_remaining: ${remainder}u128 }`
    throw new Error(`Unexpected mapping: ${p?.mapping}`)
  }
  return createClient({
    account: { type: 'local', address } as Client['account'],
    proving: { mode: 'local', generateFreezelistProof: sdk.generateFreezelistProof },
    transport: { config: { key: 'fixture', name: 'Fixture', type: 'custom', network: 'testnet', request }, request },
  })
}

function claim(c: Client) {
  return claimSwapOutput(c, {
    handle: { ...identity, swapId: '3field', transactionId: 'at1fixture', tokenInId: wrappedId,
      tokenOutId: plainId, poolKey: '1field', amountIn: 100n, program: 'shield_swap.aleo' },
    imports: {}, freezelists,
  })
}

for (const [index, address] of frozen.entries()) describe(`frozen signer ${index + 1}`, () => {
  const cases = [
    ['single-hop wrapped input', () => swap(client(address, tokenList), { ...intent, poolKey: '1field' })],
    ['multi-hop wrapped input with null proofs', () => swapMultiHop(client(address, tokenList), { ...intent, poolKeys: ['1field', '2field'], proofs: null })],
    ['claim against the AMM list', () => claim(client(address, ammList))],
    ['claim with wrapped output', () => claim(client(address, tokenList, wrappedId))],
    ['claim with wrapped input refund', () => claim(client(address, tokenList, plainId, 5n))],
  ] as const
  for (const [name, run] of cases) it(`rejects ${name} before transaction execution`, async () => {
    await expect(run()).rejects.toThrow(/^Address is frozen$/)
    expect(executeContract).not.toHaveBeenCalled()
  })
})

it('lets an unfrozen signer prepare a wrapped swap against the same populated tree', async () => {
  await expect(swap(client(allowed, tokenList), { ...intent, poolKey: '1field' })).resolves.toMatchObject({ swapId: '3field' })
  const inputs = vi.mocked(executeContract).mock.calls[0]![1].inputs!
  expect(inputs[1]).toContain('leaf_index:')
})

it('checks an AMM-frozen signer at claim, not at plain-input swap submission', async () => {
  const c = client(frozen[0]!, ammList)
  await expect(swap(c, { ...intent, poolKey: '1field', tokenInId: plainId })).resolves.toMatchObject({ swapId: '3field' })
  vi.mocked(executeContract).mockClear()
  await expect(claim(c)).rejects.toThrow(/^Address is frozen$/)
  expect(executeContract).not.toHaveBeenCalled()
})
