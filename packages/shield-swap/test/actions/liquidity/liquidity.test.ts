import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Client } from '@provablehq/veil-core'

vi.mock('@provablehq/veil-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@provablehq/veil-core')>()
  return { ...actual, executeContract: vi.fn(), writeContract: vi.fn() }
})

import { executeContract, writeContract } from '@provablehq/veil-core'
import { createPool } from '../../../src/actions/liquidity/createPool.js'
import { mint } from '../../../src/actions/liquidity/mint.js'
import { formatMintPositionRequest } from '../../../src/utils/params.js'
import { increaseLiquidity } from '../../../src/actions/liquidity/increaseLiquidity.js'
import { derivePositionTokenId } from '../../../src/utils/keys.js'
import { getSqrtPriceAtTickX128, formatU256Literal } from '../../../src/utils/q128.js'
import { EMPTY_MERKLE_PROOFS, formatMerkleProofPair } from '../../../src/utils/proofs.js'
import { clearRouteCache, programToTokenId } from '../../../src/utils/routing.js'
import { ROUTER_ADDRESSES } from '../../../src/constants.js'

const executeMock = vi.mocked(executeContract)
const writeMock = vi.mocked(writeContract)

const POOL_KEY = '4719270064611482818245310300232007815222047549513360085395965112315873598024field'
// Plain ARC-20 token ids (callers hold the tokens' own records).
const TOKEN0 = '122352848155208110005843045field'
const TOKEN1 = '15594200448253854747971580789field'
// Wrapped token ids MUST decode to program names — build them from names.
const W0 = programToTokenId('wrap_zero')
const W1 = programToTokenId('wrap_one')
const U0 = programToTokenId('under_zero')
const U1 = programToTokenId('under_one')

// The [MerkleProof; 2] literal every proof slot defaults to.
const EMPTY_PROOFS = formatMerkleProofPair(EMPTY_MERKLE_PROOFS)

const poolPlaintext = (token0: string, token1: string) =>
  `{\n  token0: ${token0},\n  token1: ${token1},\n  fee: 10000u16,\n  enabled: true\n}`
const SLOT_PLAINTEXT =
  '{\n  tick: -62200i32,\n  tick_spacing: 200u32,\n  sqrt_price: { hi: 1u128, lo: 0u128 },\n  fee_protocol: 0u8,\n  liquidity: 94217047056u128,\n  fee_growth_global0_x_128: { hi: 0u128, lo: 0u128 },\n  fee_growth_global1_x_128: { hi: 0u128, lo: 0u128 },\n  max_liquidity_per_tick: 9223372036854775808u128,\n  protocol_fees0: 0u128,\n  protocol_fees1: 0u128,\n  next_init_below: -64400i32,\n  next_init_above: -60000i32\n}'
const TOKEN0_RECORD = '{ owner: aleo1me.private, amount: 5000000000000000000u128.private, _nonce: 1group.public }'
const TOKEN1_RECORD = '{ owner: aleo1me.private, amount: 9000000u128.private, _nonce: 2group.public }'
const UNDER0_RECORD = '{ owner: aleo1me.private, amount: 7000000000000000000u128.private, _nonce: 4group.public }'
const UNDER1_RECORD = '{ owner: aleo1me.private, amount: 8000000u128.private, _nonce: 5group.public }'
const positionRecord = (token0: string, token1: string) =>
  `{\n  owner: aleo1me.private,\n  withdrawal: aleo1me.private,\n  token_id: 555field.private,\n  token0_id: ${token0}.private,\n  token1_id: ${token1}.private,\n  pool: ${POOL_KEY}.private,\n  tick_lower: -64000i32.private,\n  tick_upper: -60000i32.private,\n  _nonce: 3group.public\n}`

const RECIPIENT = 'aleo1recipient'
const WITHDRAWAL = 'aleo1withdrawal'
const ZERO_ADDRESS = 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc'

/**
 * Scripted client. `wrapped` maps a wrapped token id to its underlying id —
 * the from_wrapper_token_id fixture; every other token resolves plain.
 */
function fakeClient(
  accountType: 'local' | 'rpc',
  opts: { token0?: string; token1?: string; wrapped?: Record<string, string> } = {},
): Client {
  const token0 = opts.token0 ?? TOKEN0
  const token1 = opts.token1 ?? TOKEN1
  const recordsFor = (program?: string) => {
    if (program === 'ethx.aleo') return [{ programName: program, tag: 't0', recordPlaintext: TOKEN0_RECORD, spent: false }]
    if (program === 'usdc.aleo') return [{ programName: program, tag: 't1', recordPlaintext: TOKEN1_RECORD, spent: false }]
    if (program === 'under_zero.aleo')
      return [{ programName: program, tag: 'u0', recordPlaintext: UNDER0_RECORD, spent: false }]
    if (program === 'under_one.aleo')
      return [{ programName: program, tag: 'u1', recordPlaintext: UNDER1_RECORD, spent: false }]
    if (program === 'shield_swap.aleo')
      return [{ programName: program, tag: 't2', recordPlaintext: positionRecord(token0, token1), spent: false }]
    return []
  }
  return {
    account: { type: accountType, address: 'aleo1me' },
    recordProvider: { requestRecords: async (p: { program: string }) => recordsFor(p.program) },
    request: async (req: { method: string; params?: { mapping?: string; program?: string; key?: string } }) => {
      if (req.method === 'getMappingValue') {
        switch (req.params?.mapping) {
          case 'pools': return poolPlaintext(token0, token1)
          case 'slots': return SLOT_PLAINTEXT
          case 'fee_tiers': return 'true'
          case 'fee_to_tick_spacing': return '200u32'
          case 'from_wrapper_token_id': return opts.wrapped?.[req.params.key ?? ''] ?? null
          default: return null
        }
      }
      if (req.method === 'requestRecords') return recordsFor(req.params?.program)
      throw new Error(`unexpected method ${req.method}`)
    },
  } as unknown as Client
}

beforeEach(() => {
  executeMock.mockReset()
  writeMock.mockReset()
  clearRouteCache()
})

describe('formatMintPositionRequest', () => {
  it('emits fields in the contract struct order', () => {
    const s = formatMintPositionRequest({
      pool: '1field', tickLower: -200, tickUpper: 200,
      amount0Desired: 10n, amount1Desired: 20n, amount0Min: 1n, amount1Min: 2n,
      tickLowerHint: -400000, tickUpperHint: -100,
    })
    expect(s).toBe(
      '{ pool: 1field, tick_lower: -200i32, tick_upper: 200i32, ' +
        'amount0_desired: 10u128, amount1_desired: 20u128, amount0_min: 1u128, amount1_min: 2u128, ' +
        'tick_lower_hint: -400000i32, tick_upper_hint: -100i32 }',
    )
  })
})

describe('createPool', () => {
  it('validates the fee, resolves spacing and the U256 price default, returns poolKey', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1create', transitions: [], outputs: ['99field', 'aleo1creator'] })
    const res = await createPool(fakeClient('local'), {
      token0ProgramId: TOKEN0, token1ProgramId: TOKEN1, fee: 10000, initialTick: -62200,
    })
    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap.aleo')
    expect(call.inputs).toEqual([
      TOKEN0, TOKEN1, '10000u16',
      formatU256Literal(getSqrtPriceAtTickX128(-62200)), // derived from initialTick
      '200u32',                                          // canonical spacing from chain
      '-62200i32',
    ])
    expect(res.poolKey).toBe('99field')
  })

  it('encodes an explicit Q128.128 price as the { hi, lo } struct literal', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1create', transitions: [], outputs: ['99field', 'aleo1creator'] })
    await createPool(fakeClient('local'), {
      token0ProgramId: TOKEN0, token1ProgramId: TOKEN1, fee: 10000, initialTick: 0,
      initialSqrtPrice: (1n << 128n) + 7n,
    })
    expect(executeMock.mock.calls[0]![1].inputs[3]).toBe('{ hi: 1u128, lo: 7u128 }')
  })

  it('rejects an unregistered fee before submitting', async () => {
    const client = {
      ...fakeClient('local'),
      request: async () => null,
    } as unknown as Client
    await expect(
      createPool(client, { token0ProgramId: TOKEN0, token1ProgramId: TOKEN1, fee: 123, initialTick: 0 }),
    ).rejects.toThrow(/not registered/)
    expect(executeMock).not.toHaveBeenCalled()
  })
})

describe('mint — payout address validation', () => {
  const base = {
    poolKey: POOL_KEY, tickLower: -64400, tickUpper: -60200,
    amount0Desired: 1n, amount1Desired: 1n,
  }

  it('requires recipient and withdrawal explicitly', async () => {
    await expect(
      mint(fakeClient('local'), { ...base, recipient: RECIPIENT } as never),
    ).rejects.toThrow(/withdrawal is required/)
    await expect(
      mint(fakeClient('local'), { ...base, withdrawal: WITHDRAWAL } as never),
    ).rejects.toThrow(/recipient is required/)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('rejects the zero address and the stack program accounts', async () => {
    await expect(
      mint(fakeClient('local'), { ...base, recipient: ZERO_ADDRESS, withdrawal: WITHDRAWAL }),
    ).rejects.toThrow(/recipient must not be the zero address/)
    await expect(
      mint(fakeClient('local'), { ...base, recipient: RECIPIENT, withdrawal: ROUTER_ADDRESSES.lpRouter }),
    ).rejects.toThrow(/withdrawal must not be a program account/)
    expect(executeMock).not.toHaveBeenCalled()
  })
})

describe('mint — local, plain/plain (direct core call)', () => {
  it('rounds ticks, derives hints, auto-selects records, exact 11 positional inputs', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1mint', transitions: [], outputs: ['555field'] })
    const res = await mint(fakeClient('local'), {
      poolKey: POOL_KEY,
      tickLower: -64350,      // → rounded to -64400
      tickUpper: -60050,      // → rounded to -60200
      amount0Desired: 10n ** 18n,
      amount1Desired: 2_000_000n,
      token0Program: 'ethx.aleo',
      token1Program: 'usdc.aleo',
      nonce: '7field',
      recipient: RECIPIENT,
      withdrawal: WITHDRAWAL,
    })
    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap.aleo')
    expect(call.function).toBe('mint')
    expect(call.inputs).toHaveLength(11)
    expect(call.inputs[0]).toBe('7field')
    expect(call.inputs[1]).toBe(TOKEN0_RECORD)
    expect(call.inputs[2]).toBe(TOKEN1_RECORD)
    expect(call.inputs[3]).toBe(RECIPIENT)
    expect(call.inputs[4]).toBe(WITHDRAWAL)
    // Ticks rounded to spacing 200.
    expect(call.inputs[5]).toContain('tick_lower: -64400i32')
    expect(call.inputs[5]).toContain('tick_upper: -60200i32')
    expect(call.inputs[6]).toBe(TOKEN0)
    expect(call.inputs[7]).toBe(TOKEN1)
    // Signer/recipient/withdrawal AMM proofs default to the empty witness.
    expect(call.inputs.slice(8)).toEqual([EMPTY_PROOFS, EMPTY_PROOFS, EMPTY_PROOFS])
    expect(res.positionTokenId).toBe('555field')
  })

  it('wallet path requires both records', async () => {
    await expect(
      mint(fakeClient('rpc'), {
        poolKey: POOL_KEY, tickLower: -64400, tickUpper: -60000,
        amount0Desired: 1n, amount1Desired: 1n,
        recipient: RECIPIENT, withdrawal: WITHDRAWAL,
      }),
    ).rejects.toThrow(/must provide token0Record and token1Record/)
  })

  it('wallet path fills positionTokenId from the client-known preimage', async () => {
    writeMock.mockResolvedValue('at1walletmint')
    const recipient = 'aleo1t08epjqqv8h7jpuy2m2cxm80zy2pcy5c4f3m82hnac4sjmdrjyysvx3s2h'
    const res = await mint(fakeClient('rpc'), {
      poolKey: POOL_KEY,
      tickLower: -64400,
      tickUpper: -60200,
      amount0Desired: 10n ** 18n,
      amount1Desired: 2_000_000n,
      token0Record: '{ granted0 }',
      token1Record: '{ granted1 }',
      tickLowerHint: -64400,
      tickUpperHint: -64400,
      nonce: '7field',
      recipient,
      withdrawal: WITHDRAWAL,
    })
    expect(res.transactionId).toBe('at1walletmint')
    const call = writeMock.mock.calls[0]![1]
    expect(call.function).toBe('mint')
    expect(call.inputs).toHaveLength(11)
    expect(call.inputs[4]).toBe(WITHDRAWAL)
    // The token id preimage hashes request + recipient + nonce (not withdrawal).
    expect(res.positionTokenId).toBe(
      await derivePositionTokenId({
        request: {
          pool: POOL_KEY,
          tickLower: -64400,
          tickUpper: -60200,
          amount0Desired: 10n ** 18n,
          amount1Desired: 2_000_000n,
          amount0Min: 0n,
          amount1Min: 0n,
          tickLowerHint: -64400,
          tickUpperHint: -64400,
        },
        recipient,
        nonce: '7field',
      }),
    )
  })
})

describe('mint — router dispatch by wrapped-ness', () => {
  const base = {
    poolKey: POOL_KEY,
    tickLower: -64400,
    tickUpper: -60200,
    amount0Desired: 10n ** 18n,
    amount1Desired: 2_000_000n,
    nonce: '7field',
    recipient: RECIPIENT,
    withdrawal: WITHDRAWAL,
  }

  it('(wrapped, plain) → mint_from_wrapped_arc20 with the underlying record + sender proof', async () => {
    executeMock.mockResolvedValue({
      transactionId: 'at1mint', transitions: [],
      outputs: ['change0...', '555field'],
    })
    const client = fakeClient('local', { token0: W0, token1: TOKEN1, wrapped: { [W0]: U0 } })
    const res = await mint(client, { ...base, token1Program: 'usdc.aleo' })
    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap_lp_router.aleo')
    expect(call.function).toBe('mint_from_wrapped_arc20')
    expect(call.inputs).toHaveLength(12)
    expect(call.inputs[0]).toBe('7field')
    expect(call.inputs[1]).toBe(UNDER0_RECORD)   // underlying record, not a wrapper record
    expect(call.inputs[2]).toBe(EMPTY_PROOFS)    // sender proof follows the wrapped-side record
    expect(call.inputs[3]).toBe(TOKEN1_RECORD)
    expect(call.inputs[4]).toBe(RECIPIENT)
    expect(call.inputs[5]).toBe(WITHDRAWAL)
    expect(call.inputs[7]).toBe(W0)
    expect(call.inputs[8]).toBe(TOKEN1)
    expect(call.inputs.slice(9)).toEqual([EMPTY_PROOFS, EMPTY_PROOFS, EMPTY_PROOFS])
    // The underlying change record shifts token_id to output index 1.
    expect(res.positionTokenId).toBe('555field')
  })

  it('(plain, wrapped) → mint_from_arc20_wrapped with the proof after the wrapped record', async () => {
    executeMock.mockResolvedValue({
      transactionId: 'at1mint', transitions: [],
      outputs: ['change1...', '555field'],
    })
    const client = fakeClient('local', { token0: TOKEN0, token1: W1, wrapped: { [W1]: U1 } })
    const res = await mint(client, { ...base, token0Program: 'ethx.aleo' })
    const call = executeMock.mock.calls[0]![1]
    expect(call.function).toBe('mint_from_arc20_wrapped')
    expect(call.inputs).toHaveLength(12)
    expect(call.inputs[1]).toBe(TOKEN0_RECORD)
    expect(call.inputs[2]).toBe(UNDER1_RECORD)
    expect(call.inputs[3]).toBe(EMPTY_PROOFS)
    expect(res.positionTokenId).toBe('555field')
  })

  it('(wrapped, wrapped) → mint_from_wrapped_wrapped, token id at output index 2', async () => {
    executeMock.mockResolvedValue({
      transactionId: 'at1mint', transitions: [],
      outputs: ['change0...', 'change1...', '555field'],
    })
    const client = fakeClient('local', { token0: W0, token1: W1, wrapped: { [W0]: U0, [W1]: U1 } })
    const res = await mint(client, base)
    const call = executeMock.mock.calls[0]![1]
    expect(call.function).toBe('mint_from_wrapped_wrapped')
    expect(call.inputs).toHaveLength(13)
    expect(call.inputs[1]).toBe(UNDER0_RECORD)
    expect(call.inputs[2]).toBe(EMPTY_PROOFS)
    expect(call.inputs[3]).toBe(UNDER1_RECORD)
    expect(call.inputs[4]).toBe(EMPTY_PROOFS)
    expect(res.positionTokenId).toBe('555field')
  })
})

describe('increaseLiquidity — local', () => {
  it('plain/plain: selects the position by pool, exact 11 positional inputs', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1inc', transitions: [], outputs: ['555field'] })
    const res = await increaseLiquidity(fakeClient('local'), {
      poolKey: POOL_KEY,
      amount0Desired: 10n ** 17n,
      amount1Desired: 200_000n,
      token0Program: 'ethx.aleo',
      token1Program: 'usdc.aleo',
    })
    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap.aleo')
    expect(call.function).toBe('increase_liquidity')
    expect(call.inputs).toHaveLength(11)
    expect(call.inputs[0]).toBe(positionRecord(TOKEN0, TOKEN1))
    expect(call.inputs[1]).toBe(TOKEN0_RECORD)
    expect(call.inputs[2]).toBe(TOKEN1_RECORD)
    expect(call.inputs.slice(3, 9)).toEqual([
      '100000000000000000u128', '200000u128', '0u128', '0u128', TOKEN0, TOKEN1,
    ])
    // Hints for the position's own bounds (-64000 / -60000), from slot neighbors.
    expect(call.inputs[9]).toMatch(/i32$/)
    expect(call.inputs[10]).toMatch(/i32$/)
    expect(res.positionTokenId).toBe('555field')
  })

  it('(plain, wrapped) → increase_from_arc20_wrapped on the LP router', async () => {
    executeMock.mockResolvedValue({
      transactionId: 'at1inc', transitions: [],
      outputs: ['change1...', '555field'],
    })
    const client = fakeClient('local', { token0: TOKEN0, token1: W1, wrapped: { [W1]: U1 } })
    const res = await increaseLiquidity(client, {
      poolKey: POOL_KEY,
      amount0Desired: 10n ** 17n,
      amount1Desired: 200_000n,
      token0Program: 'ethx.aleo',
    })
    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap_lp_router.aleo')
    expect(call.function).toBe('increase_from_arc20_wrapped')
    expect(call.inputs).toHaveLength(12)
    expect(call.inputs[0]).toBe(positionRecord(TOKEN0, W1))
    expect(call.inputs[1]).toBe(TOKEN0_RECORD)
    expect(call.inputs[2]).toBe(UNDER1_RECORD)
    expect(call.inputs[3]).toBe(EMPTY_PROOFS)
    expect(call.inputs.slice(4, 10)).toEqual([
      '100000000000000000u128', '200000u128', '0u128', '0u128', TOKEN0, W1,
    ])
    expect(res.positionTokenId).toBe('555field')
  })

  it('(wrapped, wrapped) → increase_from_wrapped_wrapped, token id at output index 2', async () => {
    executeMock.mockResolvedValue({
      transactionId: 'at1inc', transitions: [],
      outputs: ['change0...', 'change1...', '555field'],
    })
    const client = fakeClient('local', { token0: W0, token1: W1, wrapped: { [W0]: U0, [W1]: U1 } })
    const res = await increaseLiquidity(client, {
      poolKey: POOL_KEY,
      amount0Desired: 1n,
      amount1Desired: 1n,
    })
    const call = executeMock.mock.calls[0]![1]
    expect(call.function).toBe('increase_from_wrapped_wrapped')
    expect(call.inputs).toHaveLength(13)
    expect(res.positionTokenId).toBe('555field')
  })

  it('wallet path requires all records + hints', async () => {
    await expect(
      increaseLiquidity(fakeClient('rpc'), {
        poolKey: POOL_KEY, amount0Desired: 1n, amount1Desired: 1n,
      }),
    ).rejects.toThrow(/must provide positionRecord/)
  })
})
