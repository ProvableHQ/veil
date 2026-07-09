import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Client } from '@veil/core'

vi.mock('@veil/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@veil/core')>()
  return { ...actual, executeContract: vi.fn(), writeContract: vi.fn() }
})

import { executeContract, writeContract } from '@veil/core'
import { decreaseLiquidity } from '../../../src/actions/liquidity/decreaseLiquidity.js'
import { collect } from '../../../src/actions/liquidity/collect.js'
import { burn } from '../../../src/actions/liquidity/burn.js'

const executeMock = vi.mocked(executeContract)
const writeMock = vi.mocked(writeContract)

const POOL_KEY = '4719270064611482818245310300232007815222047549513360085395965112315873598024field'
const TOKEN0 = '122352848155208110005843045field'
const TOKEN1 = '15594200448253854747971580789field'
const POOL_PLAINTEXT = `{\n  token0: ${TOKEN0},\n  token1: ${TOKEN1},\n  fee: 10000u16,\n  enabled: true,\n  scale0: 1000000000u128,\n  scale1: 1u128\n}`
const POSITION_RECORD = `{\n  owner: aleo1me.private,\n  token_id: 555field.private,\n  token0_id: ${TOKEN0}.private,\n  token1_id: ${TOKEN1}.private,\n  pool: ${POOL_KEY}.private,\n  tick_lower: -64000i32.private,\n  tick_upper: -60000i32.private,\n  _nonce: 3group.public\n}`

// Serves the pool mapping and, for the current DEX program, the PositionNFT.
function fakeClient(accountType: 'local' | 'rpc'): Client {
  const recordsFor = (program?: string) =>
    program === 'shield_swap_v3.aleo'
      ? [{ programName: program, tag: 't2', recordPlaintext: POSITION_RECORD, spent: false }]
      : []
  return {
    account: { type: accountType, address: 'aleo1me' },
    recordProvider: { requestRecords: async (p: { program: string }) => recordsFor(p.program) },
    request: async (req: { method: string; params?: { mapping?: string; program?: string } }) => {
      if (req.method === 'getMappingValue') return req.params?.mapping === 'pools' ? POOL_PLAINTEXT : null
      if (req.method === 'requestRecords') return recordsFor(req.params?.program)
      throw new Error(`unexpected method ${req.method}`)
    },
  } as unknown as Client
}

beforeEach(() => {
  executeMock.mockReset()
  writeMock.mockReset()
})

describe('decreaseLiquidity — local', () => {
  it('selects the position and builds exact positional inputs', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1dec', transitions: [], outputs: ['555field'] })
    const res = await decreaseLiquidity(fakeClient('local'), {
      poolKey: POOL_KEY,
      liquidityToRemove: 500_000n,
      amount0Min: 10n,
      amount1Min: 20n,
    })
    const call = executeMock.mock.calls[0]![1]
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
    expect(res.positionTokenId).toBeUndefined()
    expect(res.transactionId).toBe('at1walletDec')
  })
})

describe('collect — local', () => {
  it('resolves token ids from the pool and appends the recipient', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1col', transitions: [], outputs: ['record...'] })
    const res = await collect(fakeClient('local'), {
      poolKey: POOL_KEY,
      amount0Requested: 100n,
      amount1Requested: 200n,
      recipient: 'aleo1recipient',
    })
    const call = executeMock.mock.calls[0]![1]
    expect(call.function).toBe('collect')
    expect(call.inputs).toEqual([POSITION_RECORD, '100u128', '200u128', TOKEN0, TOKEN1, 'aleo1recipient'])
    // collect's first output is a record, not a public id — only the tx id is returned.
    expect(res).toEqual({ transactionId: 'at1col' })
  })

  it('defaults the recipient to the account address', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1col', transitions: [], outputs: [] })
    await collect(fakeClient('local'), { poolKey: POOL_KEY, amount0Requested: 1n, amount1Requested: 1n })
    expect(executeMock.mock.calls[0]![1].inputs[5]).toBe('aleo1me')
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
  it('selects the position and submits a single-input call', async () => {
    executeMock.mockResolvedValue({ transactionId: 'at1burn', transitions: [], outputs: ['555field'] })
    const res = await burn(fakeClient('local'), { poolKey: POOL_KEY })
    const call = executeMock.mock.calls[0]![1]
    expect(call.function).toBe('burn')
    expect(call.inputs).toEqual([POSITION_RECORD])
    expect(res.positionTokenId).toBe('555field')
  })
})

describe('burn — wallet', () => {
  it('requires positionRecord', async () => {
    await expect(burn(fakeClient('rpc'), { poolKey: POOL_KEY })).rejects.toThrow(/must provide positionRecord/)
  })
})
