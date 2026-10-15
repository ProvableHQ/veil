import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isFreezelistProofRequest, type Client, type InputRequest } from '@provablehq/veil-core'
vi.mock('@provablehq/veil-core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@provablehq/veil-core')>(),
  writeContract: vi.fn(), executeContract: vi.fn(),
}))
vi.mock('../../src/utils/sdk.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/utils/sdk.js')>(), tryLoadSdk: async () => undefined,
}))
import { writeContract, executeContract } from '@provablehq/veil-core'
import { swap } from '../../src/actions/swap/swap.js'
import { swapMultiHop } from '../../src/actions/swap/swapMultiHop.js'
import { claimSwapOutput } from '../../src/actions/swap/claimSwapOutput.js'
import { mint } from '../../src/actions/liquidity/mint.js'
import { increaseLiquidity } from '../../src/actions/liquidity/increaseLiquidity.js'
import { collect } from '../../src/actions/liquidity/collect.js'
import { rebalancePosition } from '../../src/actions/liquidity/rebalancePosition.js'
import { clearRouteCache, programToTokenId } from '../../src/utils/routing.js'
import { walletFreezelistProofProvider, EMPTY_MERKLE_PROOFS } from '../../src/utils/proofs.js'
import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { shieldSwapFreezelistGrants } from '../../src/utils/freezelistGrants.js'
import type { SwapHandle } from '../../src/actions/swap/swap.js'

const signer = 'aleo1signer'
const recipient = 'aleo1recipient'
const withdrawal = 'aleo1withdrawal'
const config = { ammFreezelistProgram: 'amm_list.aleo', wrapperFreezelists: { 'wrap_a.aleo': 'a_list.aleo', 'wrap_b.aleo': 'b_list.aleo' } }
const proofs = walletFreezelistProofProvider(config)
const record: InputRequest = { type: 'record' as const, program: 'token.aleo', recordname: 'Token' }
const position: InputRequest = { type: 'record' as const, program: 'shield_swap.aleo', recordname: 'PositionNFT' }
const id = (side: number, wrapped: boolean) => programToTokenId(wrapped ? (side === 0 ? 'wrap_a' : 'wrap_b') : `plain_${side}`)
const slot = '{ tick: 0i32, tick_spacing: 60u32, sqrt_price: { hi: 1u128, lo: 0u128 }, fee_protocol: 0u8, liquidity: 94217047056u128, fee_growth_global0_x_128: { hi: 0u128, lo: 0u128 }, fee_growth_global1_x_128: { hi: 0u128, lo: 0u128 }, max_liquidity_per_tick: 9223372036854775808u128, protocol_fees0: 0u128, protocol_fees1: 0u128, next_init_below: -60i32, next_init_above: 60i32 }'
function client(w0: boolean, w1: boolean, remainder = 0n, type = 'rpc'): Client {
  return {
    account: { type, address: signer },
    request: async ({ method, params }: { method: string; params?: { mapping?: string; key?: string } }) => {
      if (method === 'getLatestHeight' || method === 'getBlockNumber') return 1000n
      if (method !== 'getMappingValue') throw new Error(`unexpected ${method}`)
      if (params?.mapping === 'slots') return slot
      if (params?.mapping === 'pools') {
        const t0 = params.key === '2field' ? id(1, w1) : id(0, w0)
        const t1 = params.key === '2field' ? id(2, false) : id(1, w1)
        return `{ token0: ${t0}, token1: ${t1}, fee: 3000u16, enabled: true }`
      }
      if (params?.mapping === 'from_wrapper_token_id') {
        if (w0 && params.key === id(0, true)) return programToTokenId('under_a')
        if (w1 && params.key === id(1, true)) return programToTokenId('under_b')
        return null
      }
      if (params?.mapping === 'swap_outputs') return `{ recipient: aleo1blind, caller: aleo1blind, token_in: ${id(0, w0)}, token_out: ${id(1, w1)}, amount_out: 90u128, amount_remaining: ${remainder}u128 }`
      return null
    },
  } as unknown as Client
}
const base = { poolKey: '1field', imports: {}, proofs }
const mintParams = { ...base, tickLower: -120, tickUpper: 120, amount0Desired: 100n, amount1Desired: 100n, recipient, withdrawal, token0Record: record, token1Record: record, tickLowerHint: -600, tickUpperHint: -120, nonce: '1field' }
const increaseParams = { ...base, amount0Desired: 100n, amount1Desired: 100n, positionRecord: position, token0Record: record, token1Record: record, tickLowerHint: -600, tickUpperHint: -120 }
const collectParams = { ...base, amount0Requested: 100n, amount1Requested: 100n, positionRecord: position, withdrawalAddress: withdrawal }
const rebalanceParams = { ...base, positionRecord: position, positionTokenId: '3field', withdrawalAddress: withdrawal, tickLower: -120, tickUpper: 120, tickLowerHint: -600, tickUpperHint: -120, nonce: '1field', liquidityTarget: 100n, oldLiquidity: 100n, recovered0: 10n, recovered1: 10n, required0: 10n, required1: 10n, funded0: 0n, funded1: 0n, refund0: 0n, refund1: 0n, token0Record: record, token1Record: record }
const write = vi.mocked(writeContract)
const execute = vi.mocked(executeContract)
const abis = Object.fromEntries(['shield_swap', 'shield_swap_router', 'shield_swap_lp_router', 'shield_swap_rebalance_router'].map(name => {
  const abi = JSON.parse(readFileSync(new URL(`../../codegen/abi/${name}.json`, import.meta.url), 'utf8'))
  return [abi.program, abi]
}))
function assertProofSlots(expected: [string, string][]) {
  expect(write).toHaveBeenCalledOnce()
  const call = write.mock.calls[0]![1]
  const fn = abis[call.program].functions.find((f: { name: string }) => f.name === call.function)
  expect(call.inputs).toHaveLength(fn.inputs.length)
  const proofPositions: number[] = []
  fn.inputs.forEach((input: unknown, i: number) => { if (JSON.stringify(input).includes('MerkleProof')) proofPositions.push(i) })
  const actual = call.inputs!.filter(isFreezelistProofRequest)
  expect(actual.map(value => [value.args.freezelistProgram.value, value.args.address?.value ?? signer])).toEqual(expected)
  expect(call.inputs!.flatMap((value, i) => isFreezelistProofRequest(value) ? [i] : [])).toEqual(proofPositions)
  // Signer slots use the wallet default; explicit recipient/withdrawal slots retain addresses.
  actual.forEach((value, i) => expect(value.args.address?.value).toBe(expected[i]![1] === signer ? undefined : expected[i]![1]))
  const grants = shieldSwapFreezelistGrants(config)
  for (const inputPosition of proofPositions) {
    const input = call.inputs![inputPosition]
    expect(isFreezelistProofRequest(input)).toBe(true)
    if (!isFreezelistProofRequest(input)) continue
    const grant = grants.find(g => g.program === call.program && g.function === call.function && g.inputPosition === inputPosition)
    expect(grant?.argConstraints?.freezelistProgram).toContain(input.args.freezelistProgram.value)
  }
}

beforeEach(() => { clearRouteCache(); write.mockReset(); execute.mockReset(); write.mockResolvedValue('at1tx') })

describe('wallet freezelist requests in action inputs', () => {
  for (const w0 of [false, true]) for (const w1 of [false, true]) {
    const pair = `${w0}/${w1}`
    it(`mint and increase route ${pair} preserve exact proof slots and subjects`, async () => {
      await mint(client(w0, w1), mintParams)
      const wrappers: [string, string][] = [...(w0 ? [['a_list.aleo', signer] as [string, string]] : []), ...(w1 ? [['b_list.aleo', signer] as [string, string]] : [])]
      assertProofSlots([...wrappers, ['amm_list.aleo', signer], ['amm_list.aleo', recipient], ['amm_list.aleo', withdrawal]])
      write.mockClear()
      await increaseLiquidity(client(w0, w1), increaseParams)
      assertProofSlots(wrappers)
    })
    it(`collect route ${pair} proves the actual withdrawal subject`, async () => {
      await collect(client(w0, w1), collectParams)
      assertProofSlots([['amm_list.aleo', signer], ['amm_list.aleo', withdrawal], ...(w0 ? [['a_list.aleo', withdrawal] as [string, string]] : []), ...(w1 ? [['b_list.aleo', withdrawal] as [string, string]] : [])])
    })
    for (const fund0 of [0n, 1n]) for (const fund1 of [0n, 1n]) {
      it(`rebalance route ${pair} funding ${fund0}/${fund1} includes only consumed sender proofs`, async () => {
        const provider = vi.fn(proofs)
        await rebalancePosition(client(w0, w1), { ...rebalanceParams, funded0: fund0, funded1: fund1, proofs: provider })
        const expected: [string, string][] = [
          ...(w0 && fund0 ? [['a_list.aleo', signer] as [string, string]] : []),
          ...(w1 && fund1 ? [['b_list.aleo', signer] as [string, string]] : []),
          ...(w0 ? [['a_list.aleo', withdrawal] as [string, string]] : []),
          ...(w1 ? [['b_list.aleo', withdrawal] as [string, string]] : []),
          ['amm_list.aleo', signer], ['amm_list.aleo', withdrawal],
        ]
        assertProofSlots(expected)
        expect(provider).toHaveBeenCalledTimes(expected.length)
      })
    }
    for (const remainder of [0n, 5n]) {
      it(`claim output/refund routes ${pair}, remainder ${remainder}, use chain-selected lists`, async () => {
        const handle = { swapId: '9field', blindedAddress: 'aleo1blind', program: 'shield_swap.aleo' } as SwapHandle
        await claimSwapOutput(client(w0, w1, remainder), { handle, proofs, imports: {} })
        assertProofSlots([['amm_list.aleo', signer], ...(w1 ? [['b_list.aleo', signer] as [string, string]] : []), ...(w0 && remainder ? [['a_list.aleo', signer] as [string, string]] : [])])
      })
    }
  }

  it('supports single- and multi-hop wrapped inputs', async () => {
    const params = { ...base, tokenInId: id(0, true), amountIn: 100n, expectedOut: 90n, slippageBps: 100, tokenRecord: record, nonce: 1n }
    await swap(client(true, false), params)
    assertProofSlots([['a_list.aleo', signer]])
    write.mockClear()
    await swapMultiHop(client(true, false), { ...params, poolKeys: ['1field', '2field'] })
    assertProofSlots([['a_list.aleo', signer]])
  })

  it('rejects missing and inconsistent withdrawal subjects before submitting', async () => {
    await expect(collect(client(false, false), { ...collectParams, withdrawalAddress: undefined })).rejects.toThrow('withdrawalAddress')
    await expect(rebalancePosition(client(false, false), { ...rebalanceParams, withdrawalAddress: undefined })).rejects.toThrow('withdrawalAddress')
    const plaintext = '{ owner: aleo1signer.private, withdrawal: aleo1different.private, _nonce: 1group.public }'
    await expect(collect(client(false, false), { ...collectParams, positionRecord: plaintext })).rejects.toThrow('withdrawalAddress')
    await expect(rebalancePosition(client(false, false), { ...rebalanceParams, positionRecord: plaintext })).rejects.toThrow('withdrawalAddress')
    expect(write).not.toHaveBeenCalled()
  })

  it('reads withdrawal from granted plaintext and retains default placeholder compatibility', async () => {
    const plaintext = `{ owner: ${signer}.private, withdrawal: ${withdrawal}.private, _nonce: 1group.public }`
    await collect(client(false, false), { ...collectParams, positionRecord: plaintext, withdrawalAddress: undefined })
    assertProofSlots([['amm_list.aleo', signer], ['amm_list.aleo', withdrawal]])
    write.mockClear()
    await collect(client(false, false), { ...collectParams, withdrawalAddress: undefined, proofs: undefined })
    expect(write).toHaveBeenCalledOnce()
    write.mockClear()
    await expect(collect(client(false, false), { ...collectParams, withdrawalAddress: undefined, proofs: async () => EMPTY_MERKLE_PROOFS })).rejects.toThrow('withdrawalAddress')
    expect(write).not.toHaveBeenCalled()
  })

  it('threads a client-level provider through actions while honoring per-call overrides', async () => {
    const actions = shieldSwapActions({ proofs })(client(false, false))
    const { proofs: _proofs, ...params } = collectParams
    await actions.collect(params)
    assertProofSlots([['amm_list.aleo', signer], ['amm_list.aleo', withdrawal]])
    write.mockClear()
    await actions.collect({ ...params, proofs: async () => EMPTY_MERKLE_PROOFS })
    expect(write.mock.calls[0]![1].inputs!.filter(isFreezelistProofRequest)).toHaveLength(0)
    write.mockClear()
    await actions.collect({ ...params, proofs: undefined, withdrawalAddress: undefined })
    expect(write.mock.calls[0]![1].inputs!.filter(isFreezelistProofRequest)).toHaveLength(0)
  })

  it('rejects wallet proofs on local signing paths before submitting', async () => {
    await expect(mint(client(true, true, 0n, 'local'), mintParams)).rejects.toThrow('wallet')
    expect(execute).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })
})
