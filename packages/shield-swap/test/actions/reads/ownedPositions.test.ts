import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { getOwnedPositions } from '../../../src/actions/reads/getOwnedPositions.js'
import { getOwnedPosition } from '../../../src/actions/reads/getOwnedPosition.js'
import { deriveTickKey } from '../../../src/utils/keys.js'
import {
  getSqrtPriceAtTickX128,
  amountsForLiquidity,
  feeGrowthInside,
  feeOwed,
  toU256Parts,
} from '../../../src/utils/q128.js'

const POOL = '999field'
const OWNER = 'aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc'
const LIQ = 94217047056n

const POSITION_RECORD = `{\n  owner: ${OWNER}.private,\n  withdrawal: ${OWNER}.private,\n  token_id: 555field.private,\n  token0_id: 11field.private,\n  token1_id: 22field.private,\n  pool: ${POOL}.private,\n  tick_lower: -64400i32.private,\n  tick_upper: -60200i32.private,\n  _nonce: 1group.public\n}`

// Mapping plaintexts in the node's serving shape (u256s as { hi, lo }).
const POSITION_PLAINTEXT = `{\n  token_id: 555field,\n  pool: ${POOL},\n  tick_lower: -64400i32,\n  tick_upper: -60200i32,\n  liquidity: ${LIQ}u128,\n  fee_growth_inside0_last_x_128: { hi: 0u128, lo: 100u128 },\n  fee_growth_inside1_last_x_128: { hi: 0u128, lo: 200u128 },\n  tokens_owed0: 10u128,\n  tokens_owed1: 20u128\n}`

// Current price inside the range at tick -62000.
const SQRT_PRICE = getSqrtPriceAtTickX128(-62000)
const sp = toU256Parts(SQRT_PRICE)
const SLOT_PLAINTEXT = `{\n  tick: -62000i32,\n  tick_spacing: 200i32,\n  sqrt_price: { hi: ${sp.hi}u128, lo: ${sp.lo}u128 },\n  fee_protocol: 0u8,\n  liquidity: ${LIQ}u128,\n  fee_growth_global0_x_128: { hi: 0u128, lo: 5000u128 },\n  fee_growth_global1_x_128: { hi: 0u128, lo: 9000u128 },\n  max_liquidity_per_tick: 100000000000000000000u128,\n  protocol_fees0: 0u128,\n  protocol_fees1: 0u128,\n  next_init_below: -64400i32,\n  next_init_above: -60200i32\n}`

const tickPlaintext = (tick: number, out0: bigint, out1: bigint) =>
  `{\n  pool: ${POOL},\n  liquidity_net: 0i128,\n  liquidity_gross: ${LIQ}u128,\n  tick: ${tick}i32,\n  fee_growth_outside0_x_128: { hi: 0u128, lo: ${out0}u128 },\n  fee_growth_outside1_x_128: { hi: 0u128, lo: ${out1}u128 },\n  prev: -400000i32,\n  next: 400000i32\n}`

/**
 * Fake client serving both the record scan and the mapping reads. Mapping
 * responses are keyed `mapping:key`; tick keys are derived beforehand.
 */
function fakeClient(opts: { records: string[]; mappings: Record<string, string | null> }): Client {
  return {
    account: { type: 'rpc' },
    request: async (req: { method: string; params: { program?: string; mapping?: string; key?: string } }) => {
      if (req.method === 'requestRecords')
        return opts.records.map((recordPlaintext, i) => ({
          programName: req.params.program,
          tag: `tag${i}`,
          recordPlaintext,
          spent: false,
        }))
      if (req.method === 'getMappingValue') return opts.mappings[`${req.params.mapping}:${req.params.key}`] ?? null
      throw new Error(`unexpected ${req.method}`)
    },
  } as unknown as Client
}

/** The default happy-path chain state; override individual entries per test. */
async function positionClient(
  overrides: Record<string, string | null> = {},
  records: string[] = [POSITION_RECORD],
): Promise<Client> {
  const lowerKey = await deriveTickKey({ pool: POOL, tick: -64400 })
  const upperKey = await deriveTickKey({ pool: POOL, tick: -60200 })
  return fakeClient({
    records,
    mappings: {
      'positions:555field': POSITION_PLAINTEXT,
      'frozen_position:555field': null,
      [`slots:${POOL}`]: SLOT_PLAINTEXT,
      [`ticks:${lowerKey}`]: tickPlaintext(-64400, 1000n, 2000n),
      [`ticks:${upperKey}`]: tickPlaintext(-60200, 500n, 700n),
      ...overrides,
    },
  })
}

describe('getOwnedPositions', () => {
  it('joins record, mappings, and derived state for an in-range position', async () => {
    const positions = await getOwnedPositions(await positionClient())
    expect(positions).toHaveLength(1)
    const p = positions[0]!
    expect(p.positionTokenId).toBe('555field')
    expect(p.poolKey).toBe(POOL)
    expect(p.token0Id).toBe('11field')
    expect(p.token1Id).toBe('22field')
    expect(p.tickLower).toBe(-64400)
    expect(p.tickUpper).toBe(-60200)
    expect(p.withdrawal).toBe(OWNER)
    expect(p.frozen).toBe(false)
    expect(p.record.recordPlaintext).toContain('555field')

    expect(p.state).not.toBeNull()
    expect(p.state!.liquidity).toBe(LIQ)
    expect(p.state!.tokensOwed0).toBe(10n)
    expect(p.state!.tokensOwed1).toBe(20n)
    // Derived values agree with the math helpers called directly.
    const expected = amountsForLiquidity(
      SQRT_PRICE,
      getSqrtPriceAtTickX128(-64400),
      getSqrtPriceAtTickX128(-60200),
      LIQ,
    )
    expect(p.state!.amount0).toBe(expected.amount0)
    expect(p.state!.amount1).toBe(expected.amount1)
    const range = { tickCurrent: -62000, tickLower: -64400, tickUpper: -60200 }
    const inside0 = feeGrowthInside({
      ...range,
      feeGrowthOutsideLowerX128: 1000n,
      feeGrowthOutsideUpperX128: 500n,
      feeGrowthGlobalX128: 5000n,
    })
    expect(p.state!.uncollectedFees0).toBe(10n + feeOwed(inside0, 100n, LIQ))
    const inside1 = feeGrowthInside({
      ...range,
      feeGrowthOutsideLowerX128: 2000n,
      feeGrowthOutsideUpperX128: 700n,
      feeGrowthGlobalX128: 9000n,
    })
    expect(p.state!.uncollectedFees1).toBe(20n + feeOwed(inside1, 200n, LIQ))
  })

  it('reports frozen from the frozen_position mapping', async () => {
    const client = await positionClient({ 'frozen_position:555field': '123456u32' })
    expect((await getOwnedPositions(client))[0]!.frozen).toBe(true)
  })

  it('returns state: null when the mint has not finalized (no positions entry)', async () => {
    const client = await positionClient({ 'positions:555field': null })
    const [p] = await getOwnedPositions(client)
    expect(p!.state).toBeNull()
    expect(p!.positionTokenId).toBe('555field') // record side still present
  })

  it('filters by poolKey and returns [] for an account with no positions', async () => {
    expect(await getOwnedPositions(await positionClient(), { poolKey: '888field' })).toEqual([])
    expect(await getOwnedPositions(await positionClient({}, []))).toEqual([])
  })
})

describe('getOwnedPositions closed detection', () => {
  /** A PositionNFT record for one token id, with a distinct nonce per record. */
  const nftRecord = (tokenId: string, nonce: number) =>
    POSITION_RECORD.replace('555field.private', `${tokenId}.private`).replace(
      '_nonce: 1group',
      `_nonce: ${nonce}group`,
    )

  /**
   * Fake serving the two scans separately, which is the whole point of the
   * detection: `unspent` decides what is open, `spent` decides what is closed.
   */
  async function splitClient(
    unspent: string[],
    spent: string[],
    overrides: Record<string, string | null> = {},
  ): Promise<Client> {
    const base = await positionClient(overrides, unspent)
    return {
      ...base,
      request: async (req: {
        method: string
        params: { statusFilter?: string; mapping?: string; key?: string; program?: string }
      }) => {
        if (req.method === 'requestRecords') {
          const wanted = req.params.statusFilter === 'spent' ? spent : unspent
          return wanted.map((recordPlaintext, i) => ({
            programName: req.params.program,
            tag: `tag${req.params.statusFilter}${i}`,
            recordPlaintext,
            spent: req.params.statusFilter === 'spent',
          }))
        }
        return (base as unknown as { request: (r: unknown) => Promise<unknown> }).request(req)
      },
    } as unknown as Client
  }

  it('does not scan spent records unless asked', async () => {
    const scans: Array<string | undefined> = []
    const base = await positionClient()
    const client = {
      ...base,
      request: async (req: { method: string; params: { statusFilter?: string } }) => {
        if (req.method === 'requestRecords') scans.push(req.params.statusFilter)
        return (base as unknown as { request: (r: unknown) => Promise<unknown> }).request(req)
      },
    } as unknown as Client
    const positions = await getOwnedPositions(client)
    expect(scans).toEqual(['unspent'])
    expect(positions[0]!.closed).toBe(false)
  })

  it('marks a token id whose records are all spent as closed', async () => {
    // 555 is open; 777 was burned — its only records are spent, and it has no
    // positions entry (the fake serves none for it).
    const client = await splitClient([POSITION_RECORD], [nftRecord('777field', 9)])
    const positions = await getOwnedPositions(client, { includeClosed: true })
    expect(positions.map((p) => [p.positionTokenId, p.closed])).toEqual([
      ['555field', false],
      ['777field', true],
    ])
  })

  it('keeps a position open when a spent record shares its token id', async () => {
    // Every increase/decrease/collect consumes the record and re-issues one under
    // the same id, so spent records are the NORMAL state of a live position —
    // treating their presence as a burn would close every operated-on position.
    const client = await splitClient([POSITION_RECORD], [nftRecord('555field', 2), nftRecord('555field', 3)])
    const positions = await getOwnedPositions(client, { includeClosed: true })
    expect(positions).toHaveLength(1)
    expect(positions[0]!.closed).toBe(false)
  })

  it('closes a burn whose record the scanner still reports unspent', async () => {
    // The case a records-only rule misses: the burn finalized, so the mapping
    // entry is gone, but the scanner has not marked the record spent — it can lag
    // minutes. An earlier operation left a spent record under the same id, which
    // together with the missing entry proves the burn.
    const client = await splitClient([POSITION_RECORD], [nftRecord('555field', 2)], {
      'positions:555field': null,
    })
    const [position] = await getOwnedPositions(client, { includeClosed: true })
    expect(position!.closed).toBe(true)
    expect(position!.state).toBeNull()
  })

  it('leaves an unfinalized mint pending rather than closed', async () => {
    // No entry and no consumed record: nothing has been spent, so this is a mint
    // on its way in, not a position on its way out.
    const client = await splitClient([POSITION_RECORD], [], { 'positions:555field': null })
    const [position] = await getOwnedPositions(client, { includeClosed: true })
    expect(position!.closed).toBe(false)
    expect(position!.state).toBeNull()
  })

  it('collapses a burned position’s several spent records into one entry', async () => {
    const client = await splitClient([], [nftRecord('777field', 1), nftRecord('777field', 2)])
    const positions = await getOwnedPositions(client, { includeClosed: true })
    expect(positions).toHaveLength(1)
    expect(positions[0]!.positionTokenId).toBe('777field')
  })

  it('ignores a provider that answers the spent scan with unspent records', async () => {
    // Some record providers ignore statusFilter. Taking what they return as burn
    // evidence would close every position whose mint has not finalized, so the
    // records' own spent flag is checked before it counts.
    const base = await positionClient({ 'positions:555field': null })
    const client = {
      ...base,
      request: async (req: { method: string; params: { statusFilter?: string; program?: string } }) => {
        if (req.method === 'requestRecords') {
          // Same unspent record for both scans, honestly flagged as unspent.
          return [{ programName: req.params.program, tag: 'tag0', recordPlaintext: POSITION_RECORD, spent: false }]
        }
        return (base as unknown as { request: (r: unknown) => Promise<unknown> }).request(req)
      },
    } as unknown as Client
    const [position] = await getOwnedPositions(client, { includeClosed: true })
    expect(position!.closed).toBe(false)
  })

  it('drops a spent-only id whose positions entry is still there', async () => {
    // The other direction of scanner lag: the record was consumed by an operation
    // that re-issued one, and the replacement has not been served yet. The entry
    // proves the position is alive, so returning the consumed record as operable
    // would fail at proving — it is withheld until the scan catches up.
    const client = await splitClient([], [nftRecord('555field', 4)])
    expect(await getOwnedPositions(client, { includeClosed: true })).toEqual([])
  })
})

describe('getOwnedPosition', () => {
  it('resolves one owned position by token id', async () => {
    const p = await getOwnedPosition(await positionClient(), { positionTokenId: '555field' })
    expect(p).not.toBeNull()
    expect(p!.positionTokenId).toBe('555field')
    expect(p!.state!.liquidity).toBe(LIQ)
  })

  it('returns null when the account owns no record with that token id', async () => {
    expect(await getOwnedPosition(await positionClient(), { positionTokenId: '404field' })).toBeNull()
  })
})
