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
import { getSqrtPriceAtTick } from '../../../src/utils/tick-math.js'

const executeMock = vi.mocked(executeContract)
const writeMock = vi.mocked(writeContract)

const POOL_KEY = '4719270064611482818245310300232007815222047549513360085395965112315873598024field'
const TOKEN0 = '122352848155208110005843045field'
const TOKEN1 = '15594200448253854747971580789field'
const POOL_PLAINTEXT = `{\n  token0: ${TOKEN0},\n  token1: ${TOKEN1},\n  fee: 10000u16,\n  enabled: true,\n  scale0: 1000000000u128,\n  scale1: 1u128\n}`
const SLOT_PLAINTEXT =
  '{\n  tick: -62200i32,\n  tick_spacing: 200u32,\n  sqrt_price: 411435173233802309u128,\n  fee_protocol: 0u8,\n  liquidity: 94217047056u128,\n  fee_growth_global0_x_64: 0u128,\n  fee_growth_global1_x_64: 0u128,\n  fee_residual0_x_64: 0u128,\n  fee_residual1_x_64: 0u128,\n  max_liquidity_per_tick: 9223372036854775808u128,\n  protocol_fees0: 0u128,\n  protocol_fees1: 0u128,\n  next_init_below: -64400i32,\n  next_init_above: -60000i32\n}'
const TOKEN0_RECORD = '{ owner: aleo1me.private, amount: 5000000000000000000u128.private, _nonce: 1group.public }'
const TOKEN1_RECORD = '{ owner: aleo1me.private, amount: 9000000u128.private, _nonce: 2group.public }'
const POSITION_RECORD = `{\n  owner: aleo1me.private,\n  token_id: 555field.private,\n  token0_id: ${TOKEN0}.private,\n  token1_id: ${TOKEN1}.private,\n  pool: ${POOL_KEY}.private,\n  tick_lower: -64000i32.private,\n  tick_upper: -60000i32.private,\n  _nonce: 3group.public\n}`

function fakeClient(accountType: 'local' | 'rpc'): Client {
  // Local accounts fetch records via the client's recordProvider (scanner);
  // rpc accounts via the wallet transport. Serve the same fixtures to both.
  const recordsFor = (program?: string) => {
    if (program === 'ethx.aleo') return [{ programName: program, tag: 't0', recordPlaintext: TOKEN0_RECORD, spent: false }]
    if (program === 'usdc.aleo') return [{ programName: program, tag: 't1', recordPlaintext: TOKEN1_RECORD, spent: false }]
    if (program === 'shield_swap_v3.aleo')
      return [{ programName: program, tag: 't2', recordPlaintext: POSITION_RECORD, spent: false }]
    return []
  }
  return {
    account: { type: accountType, address: 'aleo1me' },
    recordProvider: { requestRecords: async (p: { program: string }) => recordsFor(p.program) },
    request: async (req: { method: string; params?: { mapping?: string; program?: string } }) => {
      if (req.method === 'getMappingValue') {
        switch (req.params?.mapping) {
          case 'pools': return POOL_PLAINTEXT
          case 'slots': return SLOT_PLAINTEXT
          case 'fee_tiers': return 'true'
          case 'fee_to_tick_spacing': return '200u32'
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
  it('validates the fee, resolves spacing and price defaults, returns poolKey', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1create', transitions: [], outputs: ['99field', 'aleo1creator'] })
    const res = await createPool(fakeClient('local'), {
      token0ProgramId: TOKEN0, token1ProgramId: TOKEN1, fee: 10000, initialTick: -62200,
    })
    const call = executeMock.mock.calls[0]![1]
    expect(call.inputs).toEqual([
      TOKEN0, TOKEN1, '10000u16',
      `${getSqrtPriceAtTick(-62200)}u128`, // derived from initialTick
      '200u32',                            // canonical spacing from chain
      '-62200i32',
    ])
    expect(res.poolKey).toBe('99field')
  })

  it('rejects an unregistered fee before submitting', async () => {
    const client = {
      ...fakeClient('local'),
      request: async (req: { method: string; params?: { mapping?: string } }) =>
        req.params?.mapping === 'fee_tiers' ? null : null,
    } as unknown as Client
    await expect(
      createPool(client, { token0ProgramId: TOKEN0, token1ProgramId: TOKEN1, fee: 123, initialTick: 0 }),
    ).rejects.toThrow(/not registered/)
    expect(executeMock).not.toHaveBeenCalled()
  })
})

describe('mint — local', () => {
  it('rounds ticks, derives hints from slot neighbors, auto-selects records, exact inputs', async () => {
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
      recipient: 'aleo1recipient',
    })
    const call = executeMock.mock.calls[0]![1]
    expect(call.function).toBe('mint')
    expect(call.inputs[0]).toBe('7field')
    expect(call.inputs[1]).toBe(TOKEN0_RECORD)
    expect(call.inputs[2]).toBe(TOKEN1_RECORD)
    expect(call.inputs[3]).toBe('aleo1recipient')
    // Ticks rounded to spacing 200; hints from slot neighbors:
    // -64400 ≤ slot.tick → hint = next_init_below (-64400)... target BELOW current tick
    expect(call.inputs[4]).toContain('tick_lower: -64400i32')
    expect(call.inputs[4]).toContain('tick_upper: -60200i32')
    expect(call.inputs[5]).toBe(TOKEN0)
    expect(call.inputs[6]).toBe(TOKEN1)
    expect(res.positionTokenId).toBe('555field')
  })

  it('wallet path requires both records', async () => {
    await expect(
      mint(fakeClient('rpc'), {
        poolKey: POOL_KEY, tickLower: -64400, tickUpper: -60000,
        amount0Desired: 1n, amount1Desired: 1n,
      }),
    ).rejects.toThrow(/must provide token0Record and token1Record/)
  })
})

describe('increaseLiquidity — local', () => {
  it('selects the position by pool, uses its bounds for hints, exact input order', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1inc', transitions: [], outputs: ['555field'] })
    const res = await increaseLiquidity(fakeClient('local'), {
      poolKey: POOL_KEY,
      amount0Desired: 10n ** 17n,
      amount1Desired: 200_000n,
      token0Program: 'ethx.aleo',
      token1Program: 'usdc.aleo',
    })
    const call = executeMock.mock.calls[0]![1]
    expect(call.function).toBe('increase_liquidity')
    expect(call.inputs[0]).toBe(POSITION_RECORD)
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

  it('wallet path requires all records + hints', async () => {
    await expect(
      increaseLiquidity(fakeClient('rpc'), {
        poolKey: POOL_KEY, amount0Desired: 1n, amount1Desired: 1n,
      }),
    ).rejects.toThrow(/must provide positionRecord/)
  })
})
