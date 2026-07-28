import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { parseTokenRecordInfo, selectTokenRecord, getPrivateBalances, listPositionNFTs, selectPositionNFT } from '../../src/utils/records.js'

// Wrapper-program record shape (owner/amount/_nonce) — as produced by e.g.
// ethx_5a095e.aleo transfer_public_to_private. Mirrors the amm-app parser.
const wrapperRecord = (amount: string) =>
  `{\n  owner: aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc.private,\n  amount: ${amount}.private,\n  _nonce: 1group.public\n}`

// token_registry record shape (has token_id + authorization fields).
const registryRecord = (amount: string, tokenId: string) =>
  `{\n  owner: aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc.private,\n  amount: ${amount}.private,\n  token_id: ${tokenId}.private,\n  external_authorization_required: false.private,\n  authorized_until: 4294967295u32.private,\n  _nonce: 2group.public\n}`

/** Wallet-client fake whose scanner returns the given plaintexts as unspent records. */
function recordsClient(byProgram: Record<string, string[]>): Client {
  return {
    account: { type: 'rpc' },
    request: async (req: { method: string; params: { program: string } }) => {
      if (req.method !== 'requestRecords') throw new Error(`unexpected ${req.method}`)
      return (byProgram[req.params.program] ?? []).map((recordPlaintext, i) => ({
        programName: req.params.program,
        tag: `tag${i}`,
        recordPlaintext,
        spent: false,
      }))
    },
  } as unknown as Client
}

describe('parseTokenRecordInfo', () => {
  it('parses wrapper records (no token_id)', () => {
    const info = parseTokenRecordInfo(wrapperRecord('5000u128'))
    expect(info).toEqual({ amount: 5000n, tokenId: undefined, recipientBound: false, boundRecipient: undefined })
  })

  it('parses registry records with token_id', () => {
    const info = parseTokenRecordInfo(registryRecord('77u128', '11field'))
    expect(info!.amount).toBe(77n)
    expect(info!.tokenId).toBe('11field')
  })

  it('returns null for non-token records', () => {
    expect(parseTokenRecordInfo('{ owner: aleo1abc.private, _nonce: 1group.public }')).toBeNull()
    expect(parseTokenRecordInfo('not a record')).toBeNull()
  })
})

describe('selectTokenRecord', () => {
  it('picks the smallest sufficient record', async () => {
    const client = recordsClient({
      'ethx.aleo': [wrapperRecord('100u128'), wrapperRecord('5000u128'), wrapperRecord('700u128')],
    })
    const picked = await selectTokenRecord(client, { program: 'ethx.aleo', minAmount: 500n })
    expect(picked.amount).toBe(700n) // smallest ≥ 500
  })

  it('filters registry records by token id', async () => {
    const client = recordsClient({
      'registry.aleo': [registryRecord('1000u128', '11field'), registryRecord('1000u128', '22field')],
    })
    const picked = await selectTokenRecord(client, { program: 'registry.aleo', minAmount: 1n, tokenId: '22field' })
    expect(picked.tokenId).toBe('22field')
  })

  it('throws an actionable error when nothing covers the amount', async () => {
    const client = recordsClient({ 'ethx.aleo': [wrapperRecord('100u128')] })
    await expect(selectTokenRecord(client, { program: 'ethx.aleo', minAmount: 500n })).rejects.toThrow(
      /No unspent ethx.aleo record covers 500/,
    )
  })
})

describe('getPrivateBalances', () => {
  it('sums per wrapper program and per registry token id', async () => {
    const client = recordsClient({
      'ethx.aleo': [wrapperRecord('100u128'), wrapperRecord('250u128')],
      'registry.aleo': [registryRecord('10u128', '11field'), registryRecord('5u128', '11field'), registryRecord('7u128', '22field')],
    })
    const balances = await getPrivateBalances(client, { programs: ['ethx.aleo', 'registry.aleo'] })
    expect(balances).toEqual({
      'ethx.aleo': 350n,
      'registry.aleo/11field': 15n,
      'registry.aleo/22field': 7n,
    })
  })

  it('skips records without plaintext (ungranted) rather than failing', async () => {
    const client = {
      account: { type: 'rpc' },
      request: async () => [
        { programName: 'ethx.aleo', tag: 't0', recordPlaintext: wrapperRecord('100u128'), spent: false },
        { programName: 'ethx.aleo', tag: 't1', uid: 'opaque', spent: false }, // withheld plaintext
      ],
    } as unknown as Client
    const balances = await getPrivateBalances(client, { programs: ['ethx.aleo'] })
    expect(balances).toEqual({ 'ethx.aleo': 100n })
  })
})

// PositionNFT record shape from shield_swap.aleo (generated/shield_swap.ts toPositionNFT).
const positionRecord = (tokenId: string, pool: string, tickLower: string, tickUpper: string) =>
  `{\n  owner: aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc.private,\n  withdrawal: aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc.private,\n  token_id: ${tokenId}.private,\n  token0_id: 11field.private,\n  token1_id: 22field.private,\n  pool: ${pool}.private,\n  tick_lower: ${tickLower}.private,\n  tick_upper: ${tickUpper}.private,\n  _nonce: 1group.public\n}`

describe('listPositionNFTs', () => {
  it('returns every PositionNFT with pool, token ids, withdrawal, and ticks decoded', async () => {
    const client = recordsClient({
      'shield_swap.aleo': [
        positionRecord('555field', '999field', '-64400i32', '-60200i32'),
        positionRecord('777field', '888field', '100i32', '200i32'),
      ],
    })
    const positions = await listPositionNFTs(client, { program: 'shield_swap.aleo' })
    expect(positions).toHaveLength(2)
    expect(positions[0]).toMatchObject({
      tokenId: '555field',
      poolKey: '999field',
      token0Id: '11field',
      token1Id: '22field',
      tickLower: -64400,
      tickUpper: -60200,
    })
    expect(positions[0]!.withdrawal).toMatch(/^aleo1/)
    expect(positions[0]!.record.recordPlaintext).toContain('555field')
  })

  it('filters by poolKey when given', async () => {
    const client = recordsClient({
      'shield_swap.aleo': [
        positionRecord('555field', '999field', '-64400i32', '-60200i32'),
        positionRecord('777field', '888field', '100i32', '200i32'),
      ],
    })
    const positions = await listPositionNFTs(client, { program: 'shield_swap.aleo', poolKey: '888field' })
    expect(positions.map((p) => p.tokenId)).toEqual(['777field'])
  })

  it('skips non-position records and unparseable plaintexts, and returns [] when none match', async () => {
    const client = recordsClient({
      'shield_swap.aleo': [wrapperRecord('5000u128'), 'not a record'],
    })
    expect(await listPositionNFTs(client, { program: 'shield_swap.aleo' })).toEqual([])
  })
})

describe('selectPositionNFT (wrapper over listPositionNFTs)', () => {
  it('still returns the first match for a pool and still throws on empty', async () => {
    const client = recordsClient({
      'shield_swap.aleo': [positionRecord('555field', '999field', '-64400i32', '-60200i32')],
    })
    const pos = await selectPositionNFT(client, { program: 'shield_swap.aleo', poolKey: '999field' })
    expect(pos.tokenId).toBe('555field')
    await expect(
      selectPositionNFT(client, { program: 'shield_swap.aleo', poolKey: '111field' }),
    ).rejects.toThrow(/No unspent PositionNFT/)
  })
})
