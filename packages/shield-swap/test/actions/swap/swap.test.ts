import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Client } from '@provablehq/veil-core'

// Mock ONLY the transaction-submission boundary; reads (getPool/getSlot/
// deadline/route resolution) run their real implementations against the
// scripted client.
vi.mock('@provablehq/veil-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@provablehq/veil-core')>()
  return { ...actual, executeContract: vi.fn(), writeContract: vi.fn() }
})

import { executeContract, writeContract } from '@provablehq/veil-core'
import { swap } from '../../../src/actions/swap/swap.js'
import { claimSwapOutput, SwapOutputNotFinalizedError } from '../../../src/actions/swap/claimSwapOutput.js'
import { deriveSwapId } from '../../../src/utils/keys.js'
import { programToTokenId, clearRouteCache } from '../../../src/utils/routing.js'
import { EMPTY_MERKLE_PROOFS, formatMerkleProofPair } from '../../../src/utils/proofs.js'
import { MIN_SQRT_RATIO_X128, formatU256Literal, Q128 } from '../../../src/utils/q128.js'

const executeMock = vi.mocked(executeContract)
const writeMock = vi.mocked(writeContract)

const TOKEN0 = '122352848155208110005843045field'
const TOKEN1 = '15594200448253854747971580789field'
// A wrapped pair: the wrapper's id maps to the underlying's id on chain.
const WRAPPED_IN = programToTokenId('wtok_wrapper')
const UNDERLYING_IN = programToTokenId('wtok_underlying')

const POOL_KEY = '4719270064611482818245310300232007815222047549513360085395965112315873598024field'
const IDENTITY = { blindingFactor: '111field', blindedAddress: 'aleo1t08epjqqv8h7jpuy2m2cxm80zy2pcy5c4f3m82hnac4sjmdrjyysvx3s2h' }
const RECORD = '{ owner: aleo1me.private, amount: 5000000000000000000u128.private, _nonce: 1group.public }'
const EMPTY_PROOFS = formatMerkleProofPair(EMPTY_MERKLE_PROOFS)
const MIN_LIMIT_LITERAL = formatU256Literal(MIN_SQRT_RATIO_X128)

// New-stack plaintexts: PoolState without scales; Slot with U256 sqrt_price
// (spot price 1.0); SwapOutput without hop refund slots.
const poolPlaintext = (token0: string, token1: string) =>
  `{\n  token0: ${token0},\n  token1: ${token1},\n  fee: 10000u16,\n  enabled: true\n}`
const SLOT_PLAINTEXT =
  `{\n  tick: 0i32,\n  tick_spacing: 200u32,\n  sqrt_price: { hi: 1u128, lo: 0u128 },\n  fee_protocol: 0u8,\n  liquidity: 94217047056u128,\n  fee_growth_global0_x_128: { hi: 0u128, lo: 0u128 },\n  fee_growth_global1_x_128: { hi: 0u128, lo: 0u128 },\n  max_liquidity_per_tick: 9223372036854775808u128,\n  protocol_fees0: 0u128,\n  protocol_fees1: 0u128,\n  next_init_below: -64400i32,\n  next_init_above: -60000i32\n}`
const swapOutputPlaintext = (tokenIn: string, tokenOut: string) =>
  `{\n  recipient: ${IDENTITY.blindedAddress},\n  caller: ${IDENTITY.blindedAddress},\n  token_in: ${tokenIn},\n  token_out: ${tokenOut},\n  amount_out: 1980000u128,\n  amount_remaining: 0u128\n}`

/**
 * Scripted client: chain reads answered per mapping; height fixed at 1000.
 * `from_wrapper_token_id` maps WRAPPED_IN → UNDERLYING_IN; everything else
 * reads as plain.
 */
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
        if (mapping === 'pools') return poolPlaintext(TOKEN0, TOKEN1)
        if (mapping === 'slots') return SLOT_PLAINTEXT
        if (mapping === 'swap_outputs') return swapOutputPlaintext(TOKEN0, TOKEN1)
        if (mapping === 'from_wrapper_token_id') return key === WRAPPED_IN ? UNDERLYING_IN : null
        return null
      }
      throw new Error(`unexpected method ${req.method}`)
    },
  } as unknown as Client
}

beforeEach(() => {
  executeMock.mockReset()
  writeMock.mockReset()
  clearRouteCache()
})

describe('swap — local signer, plain input (direct core dispatch)', () => {
  it('builds the exact positional literal inputs and returns a complete handle', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1tx', transitions: [], outputs: ['777field', 'record1...', 'compliance...'] })

    const handle = await swap(fakeClient('local'), {
      poolKey: POOL_KEY,
      tokenInId: TOKEN0,
      amountIn: 10n ** 18n,
      slippageBps: 100,
      expectedOut: 2_000_000n,
      nonce: 42n,
      blindedIdentity: IDENTITY,
      tokenRecord: RECORD,
    })

    expect(executeMock).toHaveBeenCalledOnce()
    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap.aleo')
    expect(call.function).toBe('swap')
    // Exact positional order per the deployed ABI (12 inputs).
    expect(call.inputs).toEqual([
      RECORD,
      IDENTITY.blindingFactor,
      IDENTITY.blindedAddress,
      POOL_KEY,
      'true',                       // zero_for_one (selling token0)
      '1000000000000000000u128',    // amount_in
      '1980000u128',                // amount_out_min = 2_000_000 × (1 − 1%)
      MIN_LIMIT_LITERAL,            // directional extreme as { hi, lo }
      '42u64',                      // nonce
      '1100u32',                    // deadline = height 1000 + 100
      TOKEN0,                       // token0_id
      TOKEN1,                       // token1_id
    ])

    expect(handle.swapId).toBe('777field') // first public output
    expect(handle.blindingFactor).toBe(IDENTITY.blindingFactor)
    expect(handle.tokenOutId).toBe(TOKEN1)
    expect(handle.tokenInWrapped).toBe(false)
    expect(handle.tokenOutWrapped).toBe(false)
    expect(handle.transactionId).toBe('at1tx')
    expect(handle.program).toBe('shield_swap.aleo')
  })

  it('rejects InputRequests on the local path', async () => {
    await expect(
      swap(fakeClient('local'), {
        poolKey: POOL_KEY,
        tokenInId: TOKEN0,
        amountIn: 10n ** 18n,
        blindedIdentity: IDENTITY,
        tokenRecord: { type: 'record', program: 'x.aleo', recordname: 'Token' },
      }),
    ).rejects.toThrow(/Local accounts cannot use InputRequests/)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('throws when the pool does not exist', async () => {
    await expect(
      swap(fakeClient('local', { pools: null }), {
        poolKey: POOL_KEY, tokenInId: TOKEN0, amountIn: 1n, blindedIdentity: IDENTITY, tokenRecord: RECORD,
      }),
    ).rejects.toThrow(/does not exist/)
  })
})

describe('swap — wrapped input (router dispatch, wrappers invisible)', () => {
  const wrappedPools = { pools: poolPlaintext(WRAPPED_IN, TOKEN1) }

  it('routes through swap_from_wrapped with the sender proof after the record', async () => {
    executeMock.mockResolvedValue({
      transactionId: 'at1routed',
      transitions: [],
      outputs: ['change-record...', '999field', 'compliance...'],
    })

    const handle = await swap(fakeClient('local', wrappedPools), {
      poolKey: POOL_KEY,
      tokenInId: WRAPPED_IN,
      amountIn: 1_000_000n,
      expectedOut: 2_000_000n,
      nonce: 42n,
      blindedIdentity: IDENTITY,
      tokenRecord: RECORD, // the UNDERLYING record — wrapper records never surface
    })

    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap_router.aleo')
    expect(call.function).toBe('swap_from_wrapped')
    // 13 inputs: underlying record, sender proof, then the core swap shape.
    expect(call.inputs!.slice(0, 4)).toEqual([RECORD, EMPTY_PROOFS, IDENTITY.blindingFactor, IDENTITY.blindedAddress])
    expect(call.inputs![4]).toBe(POOL_KEY)
    expect(call.inputs).toHaveLength(13)
    // The router's swap id is output 1 (output 0 is the change record).
    expect(handle.swapId).toBe('999field')
    expect(handle.tokenInWrapped).toBe(true)
  })

  it('refuses a routed swap whose amount_out_min resolves to zero', async () => {
    await expect(
      swap(fakeClient('local', wrappedPools), {
        poolKey: POOL_KEY,
        tokenInId: WRAPPED_IN,
        amountIn: 1_000_000n,
        expectedOut: 0n, // → amount_out_min 0, which the router asserts against
        blindedIdentity: IDENTITY,
        tokenRecord: RECORD,
      }),
    ).rejects.toThrow(/amount_out_min > 0/)
    expect(executeMock).not.toHaveBeenCalled()
  })
})

describe('swap — wallet signer', () => {
  it('fills blinding slots with issue-mode derived requests and requires tokenRecord', async () => {
    writeMock.mockResolvedValue('at1walletTx')
    const recordRequest = { type: 'record' as const, program: 'ethx.aleo', recordname: 'Token', filters: { amount: { gte: '1000000000000000000u128' } } }

    const handle = await swap(fakeClient('rpc'), {
      poolKey: POOL_KEY, tokenInId: TOKEN0, amountIn: 10n ** 18n, expectedOut: 2_000_000n, nonce: 42n,
      tokenRecord: recordRequest,
    })

    expect(writeMock).toHaveBeenCalledOnce()
    const inputs = writeMock.mock.calls[0]![1].inputs
    expect(inputs[0]).toEqual(recordRequest)
    expect(inputs[1]).toMatchObject({
      type: 'derived',
      algorithm: 'program-scoped-blinding-factor',
      args: {
        mode: { type: 'string', value: 'issue' },
        membershipProgram: { type: 'string', value: 'shield_swap.aleo' },
        membershipMapping: { type: 'string', value: 'used_blinded_addresses' },
      },
    })
    expect(inputs[2]).toMatchObject({ type: 'derived', algorithm: 'program-scoped-blinded-address' })
    // Wallet fills the private slots — unknown until confirmation.
    expect(handle.swapId).toBeUndefined()
    expect(handle.blindedAddress).toBeUndefined()
    expect(handle.transactionId).toBe('at1walletTx')
  })

  it('demands tokenRecord with an actionable message', async () => {
    await expect(
      swap(fakeClient('rpc'), { poolKey: POOL_KEY, tokenInId: TOKEN0, amountIn: 10n ** 18n }),
    ).rejects.toThrow(/must provide tokenRecord/)
  })

  it('derives swapId when the caller supplied the blinded identity', async () => {
    writeMock.mockResolvedValue('at1walletTx')
    const handle = await swap(fakeClient('rpc'), {
      poolKey: POOL_KEY, tokenInId: TOKEN0, amountIn: 10n ** 18n, expectedOut: 2_000_000n, nonce: 42n,
      blindedIdentity: IDENTITY,
      tokenRecord: RECORD,
    })
    expect(handle.swapId).toBe(
      await deriveSwapId({
        poolKey: POOL_KEY,
        zeroForOne: true,
        amountIn: 10n ** 18n,
        sqrtPriceLimit: MIN_SQRT_RATIO_X128,
        blindedAddress: IDENTITY.blindedAddress,
        nonce: 42n,
      }),
    )
    // The handle carries the preimage fields, so a late derivation
    // (once the blinded address is known) needs nothing else.
    expect(handle.zeroForOne).toBe(true)
    expect(handle.sqrtPriceLimit).toBe(MIN_SQRT_RATIO_X128)
    expect(handle.nonce).toBe(42n)
  })

  it('routes a wrapped input through the router on the wallet path too', async () => {
    writeMock.mockResolvedValue('at1walletRouted')
    await swap(fakeClient('rpc', { pools: poolPlaintext(WRAPPED_IN, TOKEN1) }), {
      poolKey: POOL_KEY,
      tokenInId: WRAPPED_IN,
      amountIn: 1_000_000n,
      expectedOut: 2_000_000n,
      tokenRecord: RECORD,
    })
    const call = writeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap_router.aleo')
    expect(call.function).toBe('swap_from_wrapped')
    expect(call.inputs![1]).toBe(EMPTY_PROOFS) // sender proof after the record
  })
})

describe('claimSwapOutput — unified dispatch', () => {
  const handle = {
    swapId: '777field',
    ...IDENTITY,
    tokenInId: TOKEN0,
    tokenOutId: TOKEN1,
    poolKey: POOL_KEY,
    amountIn: 10n ** 18n,
    transactionId: 'at1tx',
    program: 'shield_swap.aleo',
  }

  it('plain/plain: core claim with the AMM proof pair as the last input', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1claim', transitions: [], outputs: [] })
    const res = await claimSwapOutput(fakeClient('local'), { handle })

    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap.aleo')
    expect(call.function).toBe('claim_swap_output')
    expect(call.inputs).toEqual([
      IDENTITY.blindingFactor,
      IDENTITY.blindedAddress,
      '777field',
      TOKEN0,          // token_in — from CHAIN, not handle
      TOKEN1,
      '1980000u128',   // amount_out from chain
      '0u128',         // amount_remaining from chain
      EMPTY_PROOFS,    // signer freezelist proofs (empty-tree witness)
    ])
    expect(res.amountOut).toBe(1_980_000n)
    expect(res.transactionId).toBe('at1claim')
  })

  it('wrapped output, plain refund: dispatches claim_to_wrapped_refund_arc20', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1claimW', transitions: [], outputs: [] })
    await claimSwapOutput(fakeClient('local', { swap_outputs: swapOutputPlaintext(TOKEN0, WRAPPED_IN) }), { handle })

    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap_router.aleo')
    expect(call.function).toBe('claim_to_wrapped_refund_arc20')
    // 9 inputs: the core claim shape with amm proof + receiver proof.
    expect(call.inputs!.slice(-2)).toEqual([EMPTY_PROOFS, EMPTY_PROOFS])
    expect(call.inputs).toHaveLength(9)
  })

  it('plain output, wrapped refund: dispatches claim_to_arc20_refund_wrapped', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1claimR', transitions: [], outputs: [] })
    await claimSwapOutput(fakeClient('local', { swap_outputs: swapOutputPlaintext(WRAPPED_IN, TOKEN1) }), { handle })

    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap_router.aleo')
    expect(call.function).toBe('claim_to_arc20_refund_wrapped')
    expect(call.inputs).toHaveLength(9)
  })

  it('both wrapped: dispatches claim_to_wrapped_refund_wrapped with both receiver proofs', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1claimWW', transitions: [], outputs: [] })
    await claimSwapOutput(fakeClient('local', { swap_outputs: swapOutputPlaintext(WRAPPED_IN, WRAPPED_IN) }), { handle })

    const call = executeMock.mock.calls[0]![1]
    expect(call.function).toBe('claim_to_wrapped_refund_wrapped')
    expect(call.inputs).toHaveLength(10)
  })

  it('wallet: resolve-mode derived requests target the handle blindedAddress', async () => {
    writeMock.mockResolvedValue('at1walletClaim')
    await claimSwapOutput(fakeClient('rpc'), { handle })

    const inputs = writeMock.mock.calls[0]![1].inputs
    expect(inputs[0]).toMatchObject({
      type: 'derived',
      algorithm: 'program-scoped-blinding-factor',
      args: {
        mode: { type: 'string', value: 'resolve' },
        targetAddress: { type: 'address', value: IDENTITY.blindedAddress },
      },
    })
    expect(inputs[2]).toBe('777field')
  })

  it('throws SwapOutputNotFinalizedError when the output is absent', async () => {
    await expect(
      claimSwapOutput(fakeClient('local', { swap_outputs: null }), { handle }),
    ).rejects.toThrow(SwapOutputNotFinalizedError)
  })

  it('demands swapId (wallet-path resolution) before claiming', async () => {
    await expect(
      claimSwapOutput(fakeClient('local'), { handle: { ...handle, swapId: undefined } }),
    ).rejects.toThrow(/resolve it from the confirmed/)
  })
})
