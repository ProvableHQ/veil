import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Client } from '@provablehq/veil-core'

// Mock ONLY the transaction-submission boundary; reads (pools/slots/deadline)
// run their real implementations against the scripted client.
vi.mock('@provablehq/veil-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@provablehq/veil-core')>()
  return { ...actual, executeContract: vi.fn(), writeContract: vi.fn() }
})

import { executeContract, writeContract } from '@provablehq/veil-core'
import { swapMultiHop } from '../../../src/actions/swap/swapMultiHop.js'
import { claimMultiHopOutput } from '../../../src/actions/swap/claimMultiHopOutput.js'
import { SwapOutputNotFinalizedError } from '../../../src/actions/swap/claimSwapOutput.js'
import { deriveMultiHopSwapId } from '../../../src/utils/keys.js'
import { EMPTY_SWAP_HOP_LITERAL } from '../../../src/utils/params.js'
import { MIN_SQRT_PRICE, MAX_SQRT_PRICE, Q64 } from '../../../src/utils/tick-math.js'

const executeMock = vi.mocked(executeContract)
const writeMock = vi.mocked(writeContract)

// Two-hop route A→B→C over pools P1 (A/B) and P2 (C/B — reverse direction).
const TOKEN_A = '111field'
const TOKEN_B = '222field'
const TOKEN_C = '333field'
const POOL_1 = '1001field'
const POOL_2 = '1002field'
const IDENTITY = {
  blindingFactor: '111field',
  blindedAddress: 'aleo1t08epjqqv8h7jpuy2m2cxm80zy2pcy5c4f3m82hnac4sjmdrjyysvx3s2h',
}
const RECORD = '{ owner: aleo1me.private, amount: 5000000u128.private, _nonce: 1group.public }'

const poolPlaintext = (token0: string, token1: string) =>
  `{\n  token0: ${token0},\n  token1: ${token1},\n  fee: 3000u16,\n  enabled: true,\n  scale0: 1u128,\n  scale1: 1u128\n}`
const SLOT_PLAINTEXT =
  `{\n  tick: 0i32,\n  tick_spacing: 60u32,\n  sqrt_price: ${Q64}u128,\n  fee_protocol: 0u8,\n  liquidity: 94217047056u128,\n  fee_growth_global0_x_64: 0u128,\n  fee_growth_global1_x_64: 0u128,\n  fee_residual0_x_64: 0u128,\n  fee_residual1_x_64: 0u128,\n  max_liquidity_per_tick: 9223372036854775808u128,\n  protocol_fees0: 0u128,\n  protocol_fees1: 0u128,\n  next_init_below: -60i32,\n  next_init_above: 60i32\n}`
const SWAP_OUTPUT_PLAINTEXT =
  `{\n  recipient: ${IDENTITY.blindedAddress},\n  caller: ${IDENTITY.blindedAddress},\n  token_in: ${TOKEN_A},\n  token_out: ${TOKEN_C},\n  amount_out: 990000u128,\n  amount_remaining: 0u128,\n  token_in_1: ${TOKEN_B},\n  amount_remaining_1: 55u128,\n  token_in_2: 0field,\n  amount_remaining_2: 0u128\n}`

/** Scripted client: pools keyed by pool key; height fixed at 1000. */
function fakeClient(accountType: 'local' | 'rpc', overrides: Record<string, unknown> = {}): Client {
  return {
    account: {
      type: accountType,
      address: 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px',
      viewKey: 'AViewKey1unused',
    },
    request: async (req: { method: string; params?: { mapping?: string; key?: string } }) => {
      if (req.method === 'getLatestHeight' || req.method === 'getBlockNumber') return 1000n
      if (req.method === 'getMappingValue') {
        const { mapping, key } = req.params ?? {}
        if (mapping && mapping in overrides) return overrides[mapping]
        if (mapping === 'pools') return key === POOL_1 ? poolPlaintext(TOKEN_A, TOKEN_B) : poolPlaintext(TOKEN_C, TOKEN_B)
        if (mapping === 'slots') return SLOT_PLAINTEXT
        if (mapping === 'swap_outputs') return SWAP_OUTPUT_PLAINTEXT
        return null
      }
      throw new Error(`unexpected method ${req.method}`)
    },
  } as unknown as Client
}

beforeEach(() => {
  executeMock.mockReset()
  writeMock.mockReset()
})

describe('swapMultiHop — local signer', () => {
  it('builds the exact 13-slot positional inputs with zero-padded hop2', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1mh', transitions: [], outputs: ['888field', 'record...', 'compliance...'] })

    const handle = await swapMultiHop(fakeClient('local'), {
      poolKeys: [POOL_1, POOL_2],
      tokenInId: TOKEN_A,
      amountIn: 1_000_000n,
      slippageBps: 100,
      expectedOut: 1_000_000n,
      nonce: 42n,
      blindedIdentity: IDENTITY,
      tokenRecord: RECORD,
    })

    expect(executeMock).toHaveBeenCalledOnce()
    const call = executeMock.mock.calls[0]![1]
    expect(call.function).toBe('swap_multi_hop')
    // Blinding slots FIRST, then the record — the multi-hop ABI order
    // (single-hop swap is record-first).
    expect(call.inputs).toEqual([
      IDENTITY.blindingFactor,
      IDENTITY.blindedAddress,
      RECORD,
      TOKEN_A,
      TOKEN_C,                     // resolved by walking the token path
      '1000000u128',
      '990000u128',                // amount_out_min = 1_000_000 × (1 − 1%)
      `{ pool: ${POOL_1}, zero_for_one: true, sqrt_price_limit: ${MIN_SQRT_PRICE}u128 }`,
      `{ pool: ${POOL_2}, zero_for_one: false, sqrt_price_limit: ${MAX_SQRT_PRICE}u128 }`,
      EMPTY_SWAP_HOP_LITERAL,      // unused hop2, zero-padded
      '2u8',                       // hop_count
      '42u64',
      '1100u32',                   // deadline = height 1000 + 100
    ])

    expect(handle.swapId).toBe('888field') // first public output
    expect(handle.tokenOutId).toBe(TOKEN_C)
    expect(handle.hops).toHaveLength(2)
    expect(handle.amountOutMin).toBe(990000n)
    expect(handle.deadline).toBe(1100)
  })

  it('throws when a pool on the route does not exist', async () => {
    await expect(
      swapMultiHop(fakeClient('local', { pools: null }), {
        poolKeys: [POOL_1, POOL_2], tokenInId: TOKEN_A, amountIn: 1n,
        blindedIdentity: IDENTITY, tokenRecord: RECORD,
      }),
    ).rejects.toThrow(/does not exist/)
  })
})

describe('swapMultiHop — wallet signer', () => {
  it('requires tokenRecord', async () => {
    await expect(
      swapMultiHop(fakeClient('rpc'), { poolKeys: [POOL_1, POOL_2], tokenInId: TOKEN_A, amountIn: 1n }),
    ).rejects.toThrow(/must provide tokenRecord/)
  })

  it('derives swapId when the caller supplied the blinded identity', async () => {
    writeMock.mockResolvedValue('at1walletMh')
    const handle = await swapMultiHop(fakeClient('rpc'), {
      poolKeys: [POOL_1, POOL_2],
      tokenInId: TOKEN_A,
      amountIn: 1_000_000n,
      expectedOut: 1_000_000n,
      slippageBps: 100,
      nonce: 42n,
      blindedIdentity: IDENTITY,
      tokenRecord: RECORD,
    })
    // Blinding slots first on the wallet path too.
    expect(writeMock.mock.calls[0]![1].inputs.slice(0, 3)).toEqual([
      IDENTITY.blindingFactor,
      IDENTITY.blindedAddress,
      RECORD,
    ])
    expect(handle.swapId).toBe(
      await deriveMultiHopSwapId({
        tokenInId: TOKEN_A,
        tokenOutId: TOKEN_C,
        amountIn: 1_000_000n,
        amountOutMin: 990000n,
        blindedAddress: IDENTITY.blindedAddress,
        hops: handle.hops,
        nonce: 42n,
        deadline: 1100,
      }),
    )
  })

  it('leaves swapId undefined without a supplied identity', async () => {
    writeMock.mockResolvedValue('at1walletMh')
    const handle = await swapMultiHop(fakeClient('rpc'), {
      poolKeys: [POOL_1, POOL_2],
      tokenInId: TOKEN_A,
      amountIn: 1_000_000n,
      tokenRecord: { type: 'record', program: 'a.aleo', recordname: 'Token' },
    })
    expect(handle.swapId).toBeUndefined()
    expect(handle.blindedAddress).toBeUndefined()
  })
})

describe('claimMultiHopOutput', () => {
  const handle = {
    swapId: '888field',
    ...IDENTITY,
    tokenInId: TOKEN_A,
    tokenOutId: TOKEN_C,
    poolKeys: [POOL_1, POOL_2],
    hops: [
      { poolKey: POOL_1, zeroForOne: true, sqrtPriceLimit: MIN_SQRT_PRICE },
      { poolKey: POOL_2, zeroForOne: false, sqrtPriceLimit: MAX_SQRT_PRICE },
    ],
    amountIn: 1_000_000n,
    amountOutMin: 990000n,
    nonce: 42n,
    deadline: 1100,
    transactionId: 'at1mh',
    program: 'shield_swap_v3.aleo',
  }

  it('local: mirrors the SwapOutput entry into the 11-slot claim inputs', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1claimMh', transitions: [], outputs: [] })
    const res = await claimMultiHopOutput(fakeClient('local'), { handle })

    const call = executeMock.mock.calls[0]![1]
    expect(call.function).toBe('claim_multi_hop_output')
    expect(call.inputs).toEqual([
      IDENTITY.blindingFactor,
      IDENTITY.blindedAddress,
      '888field',
      TOKEN_A,          // token_in — from CHAIN, not handle
      TOKEN_C,          // token_out
      '990000u128',     // amount_out
      '0u128',          // amount_remaining
      TOKEN_B,          // token_in_1 (intermediate refund)
      '55u128',         // amount_remaining_1
      '0field',         // token_in_2 padding
      '0u128',          // amount_remaining_2
    ])
    expect(res.amountOut).toBe(990000n)
    expect(res.amountRemaining).toBe(0n)
    // Zero-amount padding filtered; the real intermediate refund surfaces.
    expect(res.hopRefunds).toEqual([{ tokenId: TOKEN_B, amount: 55n }])
  })

  it('wallet: resolve-mode derived requests target the handle blindedAddress', async () => {
    writeMock.mockResolvedValue('at1walletClaimMh')
    await claimMultiHopOutput(fakeClient('rpc'), { handle })
    const inputs = writeMock.mock.calls[0]![1].inputs
    expect(inputs[0]).toMatchObject({
      type: 'derived',
      algorithm: 'program-scoped-blinding-factor',
      args: { mode: { type: 'string', value: 'resolve' } },
    })
    expect(inputs[2]).toBe('888field')
  })

  it('throws SwapOutputNotFinalizedError when the output is absent', async () => {
    await expect(
      claimMultiHopOutput(fakeClient('local', { swap_outputs: null }), { handle }),
    ).rejects.toThrow(SwapOutputNotFinalizedError)
  })

  it('demands swapId with the derive hint', async () => {
    await expect(
      claimMultiHopOutput(fakeClient('local'), { handle: { ...handle, swapId: undefined } }),
    ).rejects.toThrow(/deriveMultiHopSwapId/)
  })
})
