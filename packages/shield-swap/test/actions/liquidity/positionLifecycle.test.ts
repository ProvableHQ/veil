import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Client } from '@provablehq/veil-core'

vi.mock('@provablehq/veil-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@provablehq/veil-core')>()
  return { ...actual, executeContract: vi.fn(), writeContract: vi.fn() }
})

import { executeContract, writeContract } from '@provablehq/veil-core'
import { decreaseLiquidity } from '../../../src/actions/liquidity/decreaseLiquidity.js'
import { collect } from '../../../src/actions/liquidity/collect.js'
import { burn } from '../../../src/actions/liquidity/burn.js'
import { EMPTY_MERKLE_PROOFS, formatMerkleProofPair } from '../../../src/utils/proofs.js'
import { clearRouteCache, programToTokenId } from '../../../src/utils/routing.js'

const executeMock = vi.mocked(executeContract)
const writeMock = vi.mocked(writeContract)

const POOL_KEY = '4719270064611482818245310300232007815222047549513360085395965112315873598024field'
const TOKEN0 = '122352848155208110005843045field'
const TOKEN1 = '15594200448253854747971580789field'
// Wrapped token ids decode to program names.
const W0 = programToTokenId('wrap_zero')
const W1 = programToTokenId('wrap_one')
const U0 = programToTokenId('under_zero')
const U1 = programToTokenId('under_one')

const EMPTY_PROOFS = formatMerkleProofPair(EMPTY_MERKLE_PROOFS)

const poolPlaintext = (token0: string, token1: string) =>
  `{\n  token0: ${token0},\n  token1: ${token1},\n  fee: 10000u16,\n  enabled: true\n}`
const positionRecord = (token0: string, token1: string) =>
  `{\n  owner: aleo1me.private,\n  withdrawal: aleo1wdrl.private,\n  token_id: 555field.private,\n  token0_id: ${token0}.private,\n  token1_id: ${token1}.private,\n  pool: ${POOL_KEY}.private,\n  tick_lower: -64000i32.private,\n  tick_upper: -60000i32.private,\n  _nonce: 3group.public\n}`
const POSITION_RECORD = positionRecord(TOKEN0, TOKEN1)

// Serves the pool mapping, wrapped-ness fixtures, and the PositionNFT.
function fakeClient(
  accountType: 'local' | 'rpc',
  opts: { token0?: string; token1?: string; wrapped?: Record<string, string> } = {},
): Client {
  const token0 = opts.token0 ?? TOKEN0
  const token1 = opts.token1 ?? TOKEN1
  const recordsFor = (program?: string) =>
    program === 'shield_swap.aleo'
      ? [{ programName: program, tag: 't2', recordPlaintext: positionRecord(token0, token1), spent: false }]
      : []
  return {
    account: { type: accountType, address: 'aleo1me' },
    recordProvider: { requestRecords: async (p: { program: string }) => recordsFor(p.program) },
    request: async (req: { method: string; params?: { mapping?: string; program?: string; key?: string } }) => {
      if (req.method === 'getMappingValue') {
        if (req.params?.mapping === 'pools') return poolPlaintext(token0, token1)
        if (req.params?.mapping === 'from_wrapper_token_id') return opts.wrapped?.[req.params.key ?? ''] ?? null
        return null
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

describe('decreaseLiquidity — local', () => {
  it('selects the position and builds exact positional inputs (always direct)', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1dec', transitions: [], outputs: ['555field'] })
    const res = await decreaseLiquidity(fakeClient('local'), {
      poolKey: POOL_KEY,
      liquidityToRemove: 500_000n,
      amount0Min: 10n,
      amount1Min: 20n,
    })
    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap.aleo')
    expect(call.function).toBe('decrease_liquidity')
    expect(call.inputs).toEqual([POSITION_RECORD, '500000u128', '10u128', '20u128'])
    expect(res.positionTokenId).toBe('555field')
  })

  it('defaults the slippage mins to zero', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1dec', transitions: [], outputs: ['555field'] })
    await decreaseLiquidity(fakeClient('local'), { poolKey: POOL_KEY, liquidityToRemove: 1n })
    expect(executeMock.mock.calls[0]![1].inputs.slice(2)).toEqual(['0u128', '0u128'])
  })
})

describe('decreaseLiquidity — wallet', () => {
  it('requires positionRecord', async () => {
    await expect(
      decreaseLiquidity(fakeClient('rpc'), { poolKey: POOL_KEY, liquidityToRemove: 1n }),
    ).rejects.toThrow(/must provide positionRecord/)
  })

  it('passes the supplied record through to writeContract', async () => {
    writeMock.mockResolvedValue('at1walletDec')
    const res = await decreaseLiquidity(fakeClient('rpc'), {
      poolKey: POOL_KEY,
      liquidityToRemove: 1n,
      positionRecord: POSITION_RECORD,
    })
    expect(writeMock.mock.calls[0]![1].inputs[0]).toBe(POSITION_RECORD)
    // The granted plaintext names the position being spent — its token_id
    // is surfaced in the return.
    expect(res.positionTokenId).toBe('555field')
    expect(res.transactionId).toBe('at1walletDec')
  })
})

describe('collect — local', () => {
  it('plain/plain: 7 positional inputs, no recipient, empty-witness proofs', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1col', transitions: [], outputs: ['record...'] })
    const res = await collect(fakeClient('local'), {
      poolKey: POOL_KEY,
      amount0Requested: 100n,
      amount1Requested: 200n,
    })
    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap.aleo')
    expect(call.function).toBe('collect')
    // No recipient slot — the contract pays the NFT's withdrawal address.
    expect(call.inputs).toEqual([
      POSITION_RECORD, '100u128', '200u128', TOKEN0, TOKEN1, EMPTY_PROOFS, EMPTY_PROOFS,
    ])
    // collect's first output is a record, not a public id — only the tx id is returned.
    expect(res).toEqual({ transactionId: 'at1col' })
  })

  it('(wrapped, plain) → collect_to_wrapped_arc20 with the receiver proof appended', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1col', transitions: [], outputs: [] })
    const client = fakeClient('local', { token0: W0, token1: TOKEN1, wrapped: { [W0]: U0 } })
    await collect(client, { poolKey: POOL_KEY, amount0Requested: 1n, amount1Requested: 1n })
    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap_lp_router.aleo')
    expect(call.function).toBe('collect_to_wrapped_arc20')
    expect(call.inputs).toEqual([
      positionRecord(W0, TOKEN1), '1u128', '1u128', W0, TOKEN1,
      EMPTY_PROOFS, EMPTY_PROOFS, EMPTY_PROOFS,
    ])
  })

  it('(plain, wrapped) → collect_to_arc20_wrapped (8 inputs)', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1col', transitions: [], outputs: [] })
    const client = fakeClient('local', { token0: TOKEN0, token1: W1, wrapped: { [W1]: U1 } })
    await collect(client, { poolKey: POOL_KEY, amount0Requested: 1n, amount1Requested: 1n })
    const call = executeMock.mock.calls[0]![1]
    expect(call.function).toBe('collect_to_arc20_wrapped')
    expect(call.inputs).toHaveLength(8)
  })

  it('(wrapped, wrapped) → collect_to_wrapped_wrapped with both receiver proofs (9 inputs)', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1col', transitions: [], outputs: [] })
    const client = fakeClient('local', { token0: W0, token1: W1, wrapped: { [W0]: U0, [W1]: U1 } })
    await collect(client, { poolKey: POOL_KEY, amount0Requested: 1n, amount1Requested: 1n })
    const call = executeMock.mock.calls[0]![1]
    expect(call.function).toBe('collect_to_wrapped_wrapped')
    expect(call.inputs).toHaveLength(9)
    expect(call.inputs.slice(5)).toEqual([EMPTY_PROOFS, EMPTY_PROOFS, EMPTY_PROOFS, EMPTY_PROOFS])
  })

  it('throws when the pool does not exist', async () => {
    const client = {
      ...fakeClient('local'),
      request: async () => null,
    } as unknown as Client
    await expect(
      collect(client, { poolKey: POOL_KEY, amount0Requested: 1n, amount1Requested: 1n }),
    ).rejects.toThrow(/does not exist/)
  })
})

describe('collect — wallet', () => {
  it('requires positionRecord', async () => {
    await expect(
      collect(fakeClient('rpc'), { poolKey: POOL_KEY, amount0Requested: 1n, amount1Requested: 1n }),
    ).rejects.toThrow(/must provide positionRecord/)
  })
})

describe('burn — local', () => {
  it('selects the position and submits a single-input call (always direct)', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1burn', transitions: [], outputs: ['555field'] })
    const res = await burn(fakeClient('local'), { poolKey: POOL_KEY })
    const call = executeMock.mock.calls[0]![1]
    expect(call.program).toBe('shield_swap.aleo')
    expect(call.function).toBe('burn')
    expect(call.inputs).toEqual([POSITION_RECORD])
    // burn outputs only [token_id, future] — the id is positional output 0.
    expect(res.positionTokenId).toBe('555field')
  })
})

describe('burn — wallet', () => {
  it('requires positionRecord', async () => {
    await expect(burn(fakeClient('rpc'), { poolKey: POOL_KEY })).rejects.toThrow(/must provide positionRecord/)
  })
})
