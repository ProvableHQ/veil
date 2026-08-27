import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Client } from '@provablehq/veil-core'

vi.mock('@provablehq/veil-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@provablehq/veil-core')>()
  return { ...actual, executeContract: vi.fn(), writeContract: vi.fn() }
})

import { executeContract, writeContract } from '@provablehq/veil-core'
import {
  previewRebalance,
  rebalancePosition,
  selectRebalanceEntry,
} from '../../../src/actions/liquidity/rebalance.js'
import { formatRebalanceAssets, formatRebalanceRequest } from '../../../src/utils/params.js'
import { amountsForLiquidity, getSqrtPriceAtTickX128, formatU256Literal } from '../../../src/utils/q128.js'
import { EMPTY_MERKLE_PROOFS, formatMerkleProofPair } from '../../../src/utils/proofs.js'
import { clearRouteCache, programToTokenId } from '../../../src/utils/routing.js'
import { SHIELD_SWAP_REBALANCE_ROUTER } from '../../../src/constants.js'

const executeMock = vi.mocked(executeContract)
const writeMock = vi.mocked(writeContract)

const POOL_KEY = '4719270064611482818245310300232007815222047549513360085395965112315873598024field'
const TOKEN0 = '122352848155208110005843045field'
const TOKEN1 = '15594200448253854747971580789field'
const W0 = programToTokenId('wrap_zero')
const U0 = programToTokenId('under_zero')
const POSITION_ID = '555field'

const EMPTY_PROOFS = formatMerkleProofPair(EMPTY_MERKLE_PROOFS)

// A price of exactly 1 (Q128.128) keeps the amount math easy to reason about.
const SQRT_PRICE = 1n << 128n
const OLD_LIQUIDITY = 1_000_000n
const OLD_LOWER = -400
const OLD_UPPER = 400
const OWED0 = 111n
const OWED1 = 222n

const poolPlaintext = (token0: string, token1: string) =>
  `{\n  token0: ${token0},\n  token1: ${token1},\n  fee: 10000u16,\n  enabled: true\n}`
const slotPlaintext = () =>
  `{\n  tick: 0i32,\n  tick_spacing: 200u32,\n  sqrt_price: ${formatU256Literal(SQRT_PRICE)},\n  fee_protocol: 0u8,\n  liquidity: ${OLD_LIQUIDITY}u128,\n  fee_growth_global0_x_128: { hi: 0u128, lo: 0u128 },\n  fee_growth_global1_x_128: { hi: 0u128, lo: 0u128 },\n  max_liquidity_per_tick: 9223372036854775808u128,\n  protocol_fees0: 0u128,\n  protocol_fees1: 0u128,\n  next_init_below: ${OLD_LOWER}i32,\n  next_init_above: ${OLD_UPPER}i32\n}`
const positionMappingPlaintext = () =>
  `{\n  token_id: ${POSITION_ID},\n  pool: ${POOL_KEY},\n  tick_lower: ${OLD_LOWER}i32,\n  tick_upper: ${OLD_UPPER}i32,\n  liquidity: ${OLD_LIQUIDITY}u128,\n  fee_growth_inside0_last_x_128: { hi: 0u128, lo: 0u128 },\n  fee_growth_inside1_last_x_128: { hi: 0u128, lo: 0u128 },\n  tokens_owed0: ${OWED0}u128,\n  tokens_owed1: ${OWED1}u128\n}`
const positionRecord = (token0: string, token1: string) =>
  `{\n  owner: aleo1me.private,\n  withdrawal: aleo1payout.private,\n  token_id: ${POSITION_ID}.private,\n  token0_id: ${token0}.private,\n  token1_id: ${token1}.private,\n  pool: ${POOL_KEY}.private,\n  tick_lower: ${OLD_LOWER}i32.private,\n  tick_upper: ${OLD_UPPER}i32.private,\n  _nonce: 3group.public\n}`
const UNDER0_RECORD = '{ owner: aleo1me.private, amount: 7000000000000000000u128.private, _nonce: 4group.public }'
const TOKEN0_RECORD = '{ owner: aleo1me.private, amount: 5000000000000000000u128.private, _nonce: 1group.public }'

function fakeClient(
  accountType: 'local' | 'rpc',
  opts: { token0?: string; token1?: string; wrapped?: Record<string, string> } = {},
): Client {
  const token0 = opts.token0 ?? TOKEN0
  const token1 = opts.token1 ?? TOKEN1
  const recordsFor = (program?: string) => {
    if (program === 'under_zero.aleo')
      return [{ programName: program, tag: 'u0', recordPlaintext: UNDER0_RECORD, spent: false }]
    if (program === 'ethx.aleo')
      return [{ programName: program, tag: 't0', recordPlaintext: TOKEN0_RECORD, spent: false }]
    if (program === 'shield_swap.aleo')
      return [{ programName: program, tag: 'p', recordPlaintext: positionRecord(token0, token1), spent: false }]
    return []
  }
  return {
    account: { type: accountType, address: 'aleo1me' },
    recordProvider: { requestRecords: async (p: { program: string }) => recordsFor(p.program) },
    request: async (req: { method: string; params?: { mapping?: string; program?: string; key?: string } }) => {
      if (req.method === 'getMappingValue') {
        switch (req.params?.mapping) {
          case 'pools': return poolPlaintext(token0, token1)
          case 'slots': return slotPlaintext()
          case 'positions': return req.params.key === POSITION_ID ? positionMappingPlaintext() : null
          case 'from_wrapper_token_id': return opts.wrapped?.[req.params.key ?? ''] ?? null
          default: return null
        }
      }
      if (req.method === 'requestRecords') return recordsFor(req.params?.program)
      if (req.method === 'latest' || req.method === 'getLatestHeight') return 1000
      throw new Error(`unexpected method ${req.method}`)
    },
  } as unknown as Client
}

// The quote the fixtures produce, recomputed the way the action does.
function expectedQuote(tickLower: number, tickUpper: number, liquidityTarget: bigint) {
  const principal = amountsForLiquidity({
    sqrtPriceX128: SQRT_PRICE,
    sqrtLowerX128: getSqrtPriceAtTickX128(OLD_LOWER),
    sqrtUpperX128: getSqrtPriceAtTickX128(OLD_UPPER),
    liquidity: OLD_LIQUIDITY,
  })
  const recovered0 = principal.amount0 + OWED0
  const recovered1 = principal.amount1 + OWED1
  const required = amountsForLiquidity({
    sqrtPriceX128: SQRT_PRICE,
    sqrtLowerX128: getSqrtPriceAtTickX128(tickLower),
    sqrtUpperX128: getSqrtPriceAtTickX128(tickUpper),
    liquidity: liquidityTarget,
    roundUp: true,
  })
  return { recovered0, recovered1, required0: required.amount0, required1: required.amount1 }
}

beforeEach(() => {
  executeMock.mockReset()
  writeMock.mockReset()
  clearRouteCache()
})

describe('selectRebalanceEntry', () => {
  it('maps every wrapper and funding combination to its router entrypoint', () => {
    const cases: Array<[boolean, boolean, boolean, boolean, string]> = [
      [false, false, false, false, 'rebalance_plain_plain_none'],
      [false, false, true, false, 'rebalance_plain_plain_one'],
      [false, false, false, true, 'rebalance_plain_plain_one'],
      [false, false, true, true, 'rebalance_plain_plain_both'],
      [true, false, false, false, 'rebalance_wrapped_plain_none'],
      [true, false, true, false, 'rebalance_wrapped_plain_fund0'],
      [true, false, false, true, 'rebalance_wrapped_plain_fund1'],
      [true, false, true, true, 'rebalance_wrapped_plain_both'],
      [false, true, false, false, 'rebalance_plain_wrapped_none'],
      [false, true, true, false, 'rebalance_plain_wrapped_fund0'],
      [false, true, false, true, 'rebalance_plain_wrapped_fund1'],
      [false, true, true, true, 'rebalance_plain_wrapped_both'],
      [true, true, false, false, 'rebalance_wrapped_wrapped_none'],
      [true, true, true, false, 'rebalance_wrapped_wrapped_one'],
      [true, true, false, true, 'rebalance_wrapped_wrapped_one'],
      [true, true, true, true, 'rebalance_wrapped_wrapped_both'],
    ]
    for (const [wrapped0, wrapped1, funds0, funds1, expected] of cases) {
      expect(selectRebalanceEntry({ wrapped0, wrapped1, funds0, funds1 })).toBe(expected)
    }
  })
})

describe('rebalance formatters', () => {
  it('emits RebalanceRequest fields in the contract struct order', () => {
    const s = formatRebalanceRequest({
      oldLiquidity: 1n, recovered0: 2n, recovered1: 3n,
      funded0: 4n, funded1: 5n, refund0: 6n, refund1: 7n,
      liquidityTarget: 8n,
      mint: {
        pool: '1field', tickLower: -200, tickUpper: 200,
        amount0Desired: 10n, amount1Desired: 20n, amount0Min: 10n, amount1Min: 20n,
        tickLowerHint: -400000, tickUpperHint: -200,
      },
      deadline: 1100,
    })
    expect(s).toBe(
      '{ old_liquidity: 1u128, recovered0: 2u128, recovered1: 3u128, ' +
        'funded0: 4u128, funded1: 5u128, refund0: 6u128, refund1: 7u128, ' +
        'liquidity_target: 8u128, mint: { pool: 1field, tick_lower: -200i32, tick_upper: 200i32, ' +
        'amount0_desired: 10u128, amount1_desired: 20u128, amount0_min: 10u128, amount1_min: 20u128, ' +
        'tick_lower_hint: -400000i32, tick_upper_hint: -200i32 }, deadline: 1100u32 }',
    )
  })

  it('emits RebalanceAssets with each side bound to its settlement token', () => {
    expect(formatRebalanceAssets({
      token0Id: W0, underlying0Id: U0, token1Id: TOKEN1, underlying1Id: TOKEN1,
    })).toBe(
      `{ token0: { token_id: ${W0}, underlying_id: ${U0} }, ` +
        `token1: { token_id: ${TOKEN1}, underlying_id: ${TOKEN1} } }`,
    )
  })
})

describe('previewRebalance', () => {
  it('quotes recovered, funded, and refund amounts against live state', async () => {
    const client = fakeClient('local')
    // A smaller successor position refunds both sides.
    const shrink = await previewRebalance(client, {
      poolKey: POOL_KEY, positionTokenId: POSITION_ID,
      tickLower: OLD_LOWER, tickUpper: OLD_UPPER, liquidityTarget: OLD_LIQUIDITY / 2n,
    })
    const shrinkExpected = expectedQuote(OLD_LOWER, OLD_UPPER, OLD_LIQUIDITY / 2n)
    expect(shrink.recovered0).toBe(shrinkExpected.recovered0)
    expect(shrink.recovered1).toBe(shrinkExpected.recovered1)
    expect(shrink.funded0).toBe(0n)
    expect(shrink.funded1).toBe(0n)
    expect(shrink.refund0).toBe(shrinkExpected.recovered0 - shrinkExpected.required0)
    expect(shrink.refund1).toBe(shrinkExpected.recovered1 - shrinkExpected.required1)
    expect(shrink.functionName).toBe('rebalance_plain_plain_none')

    // A larger successor position needs funding on both sides.
    const grow = await previewRebalance(client, {
      poolKey: POOL_KEY, positionTokenId: POSITION_ID,
      tickLower: OLD_LOWER, tickUpper: OLD_UPPER, liquidityTarget: OLD_LIQUIDITY * 2n,
    })
    const growExpected = expectedQuote(OLD_LOWER, OLD_UPPER, OLD_LIQUIDITY * 2n)
    expect(grow.funded0).toBe(growExpected.required0 - growExpected.recovered0)
    expect(grow.funded1).toBe(growExpected.required1 - growExpected.recovered1)
    expect(grow.refund0).toBe(0n)
    expect(grow.refund1).toBe(0n)
    expect(grow.functionName).toBe('rebalance_plain_plain_both')
  })

  it('rejects a range that is empty after spacing alignment', async () => {
    await expect(previewRebalance(fakeClient('local'), {
      poolKey: POOL_KEY, positionTokenId: POSITION_ID,
      tickLower: 0, tickUpper: 100, liquidityTarget: 1n,
    })).rejects.toThrow(/Empty tick range/)
  })

  it('rejects a missing position', async () => {
    await expect(previewRebalance(fakeClient('local'), {
      poolKey: POOL_KEY, positionTokenId: '999field',
      tickLower: OLD_LOWER, tickUpper: OLD_UPPER, liquidityTarget: 1n,
    })).rejects.toThrow(/Position does not exist/)
  })
})

describe('rebalancePosition', () => {
  it('submits a no-funding plain pair through the router with the exact slots', async () => {
    executeMock.mockResolvedValue({
      transactionId: 'at1tx',
      outputs: ['777field'],
    } as never)
    const client = fakeClient('local')
    const result = await rebalancePosition(client, {
      poolKey: POOL_KEY, positionTokenId: POSITION_ID,
      tickLower: OLD_LOWER, tickUpper: OLD_UPPER, liquidityTarget: OLD_LIQUIDITY / 2n,
      nonce: '9field',
    })
    expect(result.positionTokenId).toBe('777field')
    expect(result.quote.functionName).toBe('rebalance_plain_plain_none')

    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe(SHIELD_SWAP_REBALANCE_ROUTER)
    expect(call.function).toBe('rebalance_plain_plain_none')
    // [nft, nonce, request, assets, owner_proofs, withdrawal_proofs]
    expect(call.inputs).toHaveLength(6)
    expect(call.inputs![0]).toContain('withdrawal: aleo1payout')
    expect(call.inputs![1]).toBe('9field')
    expect(call.inputs![2]).toContain('old_liquidity: 1000000u128')
    expect(call.inputs![2]).toContain('amount0_min: ')
    expect(call.inputs![3]).toBe(formatRebalanceAssets({
      token0Id: TOKEN0, underlying0Id: TOKEN0, token1Id: TOKEN1, underlying1Id: TOKEN1,
    }))
    expect(call.inputs![4]).toBe(EMPTY_PROOFS)
    expect(call.inputs![5]).toBe(EMPTY_PROOFS)
  })

  it('interleaves the funded wrapped side record, sender proof, and receiver proof', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1tx', outputs: ['888field'] } as never)
    const client = fakeClient('local', { token0: W0, wrapped: { [W0]: U0 } })
    const result = await rebalancePosition(client, {
      poolKey: POOL_KEY, positionTokenId: POSITION_ID,
      tickLower: OLD_LOWER, tickUpper: OLD_UPPER, liquidityTarget: OLD_LIQUIDITY * 2n,
      token1Record: TOKEN0_RECORD,
      nonce: '9field',
    })
    expect(result.quote.functionName).toBe('rebalance_wrapped_plain_both')

    const call = executeMock.mock.calls[0]![1]
    expect(call.function).toBe('rebalance_wrapped_plain_both')
    // [nft, nonce, rec0, sender_proof0, rec1, receiver_proof0, request, assets, owner, withdrawal]
    expect(call.inputs).toHaveLength(10)
    expect(call.inputs![2]).toBe(UNDER0_RECORD)
    expect(call.inputs![3]).toBe(EMPTY_PROOFS)
    expect(call.inputs![4]).toBe(TOKEN0_RECORD)
    expect(call.inputs![5]).toBe(EMPTY_PROOFS)
    expect(call.inputs![7]).toContain(`underlying_id: ${U0}`)
  })

  it('requires the position identity and funding records on the wallet path', async () => {
    const client = fakeClient('rpc')
    await expect(rebalancePosition(client, {
      poolKey: POOL_KEY,
      tickLower: OLD_LOWER, tickUpper: OLD_UPPER, liquidityTarget: 1n,
    })).rejects.toThrow(/must provide positionTokenId and positionRecord/)

    await expect(rebalancePosition(client, {
      poolKey: POOL_KEY, positionTokenId: POSITION_ID,
      positionRecord: { type: 'record', program: 'shield_swap.aleo' } as never,
      tickLower: OLD_LOWER, tickUpper: OLD_UPPER, liquidityTarget: OLD_LIQUIDITY * 2n,
    })).rejects.toThrow(/must provide token0Record/)
    expect(writeMock).not.toHaveBeenCalled()
  })
})
