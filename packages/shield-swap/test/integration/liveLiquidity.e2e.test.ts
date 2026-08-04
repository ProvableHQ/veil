import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { resolveDexImports } from '../../src/utils/imports.js'
import { amountsForLiquidity, getSqrtPriceAtTickX128, liquidityForAmounts } from '../../src/utils/q128.js'
import { roundTickToSpacing } from '../../src/utils/tick-math.js'

/**
 * The liquidity lifecycle against the live testnet deployment: mint, increase,
 * decrease, collect, burn — plus the owned-position reads that report it.
 *
 * Mints into an existing pool. Pool creation is gated on this deployment
 * (`pool_creation_open` reads false), so a suite that created its own pool would
 * only ever skip.
 *
 * Everything is discovered: the pool from the API filtered by what the account
 * holds on both sides, tick spacing from the fee tier on chain, and the range
 * from the pool's active tick. Insert hints come from `pickInsertHint`, whose
 * correctness this exercises — a hint above its target is rejected on finalize.
 *
 * Spends real testnet balances and leaves no position behind. Requirements:
 *   VEIL_INTEGRATION=1
 *   VEIL_E2E_PRIVATE_KEY   funded testnet account, both sides of some pool
 *   ALEO_CONSUMER_ID, ALEO_DPS_API_KEY   Provable API credentials
 *
 *   VEIL_INTEGRATION=1 npx vitest run packages/shield-swap/test/integration/liveLiquidity.e2e.test.ts
 */

const PRIVATE_KEY = process.env.VEIL_E2E_PRIVATE_KEY
const CONSUMER_ID = process.env.ALEO_CONSUMER_ID
const API_KEY = process.env.ALEO_DPS_API_KEY
const RUN = process.env.VEIL_INTEGRATION === '1' && !!PRIVATE_KEY && !!CONSUMER_ID && !!API_KEY
const TX = 600_000

type Token = { address: string; symbol: string; decimals: number; amm_token_program?: string | null }
type Pool = { key: string; token0: string; token1: string }

describe.runIf(RUN)('live liquidity lifecycle on testnet', () => {
  let client: ReturnType<ReturnType<typeof shieldSwapActions>> &
    Awaited<ReturnType<Awaited<ReturnType<typeof loadNetwork>>['createAleoClient']>>['walletClient']
  let account: Awaited<ReturnType<Awaited<ReturnType<typeof loadNetwork>>['createAleoClient']>>['account']

  const state: {
    pool?: Pool
    imports?: Record<string, string>
    tickLower?: number
    tickUpper?: number
    /** A thousandth of what the account holds on each side — the deposit ceiling. */
    budget0?: bigint
    budget1?: bigint
    amount0?: bigint
    amount1?: bigint
    predicted?: bigint
    positionTokenId?: string
    liquidity?: bigint
    /** Tag of the position record the last write produced. */
    recordTag?: string
  } = {}

  /**
   * Aborts the rest of the lifecycle once any step fails.
   *
   * Every step spends what the previous one created, so after a failure the
   * remainder cannot pass — but they would still build and submit transactions,
   * paying a fee each to revert against state that never materialized. The
   * first failure is the only informative one; the rest are noise bought with
   * real funds.
   */
  let aborted: string | undefined
  afterEach((ctx) => {
    if (ctx.task.result?.state === 'fail') aborted ??= ctx.task.name
  })
  beforeEach(() => {
    if (aborted) throw new Error(`aborted: "${aborted}" failed, and the rest of the lifecycle depends on it`)
  })

  /**
   * Waits until the scanner serves a position record other than `staleTag`.
   *
   * Every write spends the position record and creates a new one, but the
   * scanner indexes that asynchronously. A write built against the spent record
   * carries a serial number the chain has already consumed, so the node drops it
   * at verification — it never reaches a block, and the only symptom is a
   * confirmation wait that times out against a transaction the chain has never
   * heard of. Checking mere presence is not enough: the spent record satisfies
   * that too, which is why the tag has to change.
   *
   * Returns the new tag, to be passed as `staleTag` after the next write.
   */
  const waitForFreshRecord = async (staleTag?: string) => {
    for (let i = 0; i < 40; i++) {
      const mine = (await client.getOwnedPositions()).find(
        (o) => o.positionTokenId === state.positionTokenId,
      )
      if (mine && mine.record.tag !== staleTag) return mine.record.tag
      await new Promise((r) => setTimeout(r, 5_000))
    }
    throw new Error(`scanner served no position record newer than ${staleTag} within 200s`)
  }

  beforeAll(async () => {
    const aleo = await loadNetwork('testnet')
    const built = aleo.createAleoClient({
      privateKey: PRIVATE_KEY!,
      networkUrl: 'https://api.provable.com/v2',
      consumerId: CONSUMER_ID,
      apiKey: API_KEY,
      records: aleo.createRemoteScanner(),
    })
    account = built.account
    client = built.walletClient.extend(shieldSwapActions({ api: {} })) as typeof client
    await client.authenticateShieldSwap()

    const tokens = (await client.api.getTokens()).data as Token[]
    const pools = (await client.api.getPools({ limit: 50 })).data as Pool[]
    // Keyed by token id and reconciled against the registry, unlike the raw
    // record sums which key by program or `program/token_id`.
    const balances = await client.getBalances()
    const held = (id: string) => balances[id]?.private ?? 0n

    // Minting needs both sides, so only a pool funded on both is usable. Among
    // those, the deepest: a thin pool moves price sharply against the deposit,
    // and the native-credits pairs on this deployment are both the thinnest and
    // the ones whose LP path needs an explicit token route.
    const candidates = []
    for (const p of pools) {
      if (held(p.token0) === 0n || held(p.token1) === 0n) continue
      const slot = await client.getSlot({ poolKey: p.key })
      if (slot) candidates.push({ pool: p, liquidity: slot.liquidity })
    }
    candidates.sort((a, b) => (b.liquidity > a.liquidity ? 1 : -1))
    state.pool = candidates[0]?.pool
    if (state.pool) {
      // Proportional rather than fixed, so the suite deposits the same small
      // share of the account however much it holds, and repeated runs cannot
      // drain it.
      state.budget0 = held(state.pool.token0) / 1000n
      state.budget1 = held(state.pool.token1) / 1000n
      state.imports = await resolveDexImports(client, {
        tokenPrograms: [state.pool.token0, state.pool.token1].map(
          (id) => tokens.find((t) => t.address === id)!.amm_token_program!,
        ),
      })
    }
  }, 180_000)

  it('finds a pool funded on both sides and derives a spacing-aligned range', async () => {
    expect(state.pool, 'no live pool is funded on both sides for this account').toBeTruthy()
    const poolKey = state.pool!.key

    const [slot, onchain] = await Promise.all([
      client.getSlot({ poolKey }),
      client.getPool({ poolKey }),
    ])
    // The pool's own spacing governs, because that is what `mint` aligns
    // against. The fee registry must agree with it — `create_pool` seeds one
    // from the other — and a pool that had drifted would take positions on a
    // grid the registry cannot describe.
    const spacing = slot!.tick_spacing
    expect(await client.getFeeToTickSpacing({ fee: onchain!.fee })).toBe(spacing)

    // Ten spacing steps either side of the active tick: wide enough that the
    // position stays in range as the price moves during the run, narrow enough
    // that the deposit is small.
    const aligned = roundTickToSpacing(slot!.tick, spacing)
    const tickLower = aligned - spacing * 10
    const tickUpper = aligned + spacing * 10
    state.tickLower = tickLower
    state.tickUpper = tickUpper
    // Straddling the active tick means the position is in range and earns fees.
    // Alignment needs no assertion — it follows from rounding then stepping by
    // whole multiples of the spacing.
    expect(tickLower).toBeLessThan(slot!.tick)
    expect(tickUpper).toBeGreaterThan(slot!.tick)

    // Start from the budget, the direction a depositor actually starts from:
    // ask what liquidity those amounts back, then deposit exactly what that
    // liquidity needs. Fixed amounts only balance at one pool's price and
    // revert elsewhere as one side falls short of what the range requires.
    const sqrtLower = getSqrtPriceAtTickX128(tickLower)
    const sqrtUpper = getSqrtPriceAtTickX128(tickUpper)
    const liquidity = liquidityForAmounts(slot!.sqrt_price, sqrtLower, sqrtUpper, state.budget0!, state.budget1!)
    expect(liquidity, 'budget is dust for this range — fund the account further').toBeGreaterThan(0n)
    state.predicted = liquidity

    // `true` is the deposit-side rounding, so neither side lands a hair short.
    const { amount0, amount1 } = amountsForLiquidity(slot!.sqrt_price, sqrtLower, sqrtUpper, liquidity, true)
    state.amount0 = amount0
    state.amount1 = amount1
    expect(amount0 + amount1).toBeGreaterThan(0n)
    // The round trip must stay inside the budget, or the mint reverts for want
    // of a base unit — and the suite would be spending more than it intended.
    expect(amount0).toBeLessThanOrEqual(state.budget0!)
    expect(amount1).toBeLessThanOrEqual(state.budget1!)
  }, 120_000)

  it('resolves insert hints that are true predecessors of the range bounds', async () => {
    const poolKey = state.pool!.key
    for (const target of [state.tickLower!, state.tickUpper!]) {
      const hint = await client.pickInsertHint({ poolKey, targetTick: target })
      const tick = await client.getTick({ poolKey, tick: hint })
      // The contract asserts this relation and reverts on finalize otherwise,
      // consuming the fee — so it is worth asserting before spending one.
      expect(hint).toBeLessThan(target)
      expect(tick, `hint ${hint} is not an initialized tick`).not.toBeNull()
      expect(tick!.next).toBeGreaterThanOrEqual(target)
    }
  }, 120_000)

  it('mints a position and the chain carries it', async () => {
    // Hints are deliberately omitted. `mint` derives both, and for the upper
    // bound it applies a correction a caller cannot: finalize inserts
    // tick_lower before validating the upper hint, so when no initialized tick
    // sits between the bounds the upper predecessor is the just-inserted lower
    // tick rather than the one visible on chain. Passing an explicit
    // tickUpperHint disables that correction and reverts on exactly that case.
    const minted = await client.mint({
      poolKey: state.pool!.key,
      tickLower: state.tickLower!,
      tickUpper: state.tickUpper!,
      amount0Desired: state.amount0!,
      amount1Desired: state.amount1!,
      recipient: account.address,
      withdrawal: account.address,
      imports: state.imports,
    })
    // Optional only for wallet signers given just a positionRecord; the local
    // path always returns it.
    expect(minted.positionTokenId).toBeTruthy()
    state.positionTokenId = minted.positionTokenId
    expect(minted.transactionId).toBeTruthy()

    const position = await client.getPosition({ positionTokenId: state.positionTokenId! })
    expect(position).not.toBeNull()
    expect(position!.liquidity).toBeGreaterThan(0n)
    expect(position!.tick_lower).toBe(state.tickLower)
    expect(position!.tick_upper).toBe(state.tickUpper)

    // The chain derives liquidity from the deposited amounts the same way
    // `liquidityForAmounts` does, so the two must agree — this is the parity
    // check on both contract-math mirrors, with the chain as the authority.
    // Not exact: a trade landing between the slot read and this finalize moves
    // the price, which shifts how much of each side the range consumes.
    const drift = Number(position!.liquidity - state.predicted!) / Number(state.predicted!)
    expect(Math.abs(drift), `predicted ${state.predicted}, chain minted ${position!.liquidity}`).toBeLessThan(0.01)
    state.liquidity = position!.liquidity
  }, TX)

  it('lists the new position through the owned-position reads', async () => {
    // No prior tag: any record for this position is the mint's output.
    state.recordTag = await waitForFreshRecord()
    const owned = await client.getOwnedPositions()
    const mine = owned.find((o) => o.positionTokenId === state.positionTokenId)
    expect(mine, 'minted position is not among the owned positions').toBeTruthy()
    // `state` is null only while the positions entry lags the record; by now the
    // mint has confirmed, so the joined view must be present.
    expect(mine!.state).not.toBeNull()
    expect(mine!.state!.liquidity).toBe(state.liquidity)

    const single = await client.getOwnedPosition({ positionTokenId: state.positionTokenId! })
    expect(single!.state!.liquidity).toBe(state.liquidity)
  }, 120_000)

  it('increases liquidity on the position', async () => {
    await client.increaseLiquidity({
      positionTokenId: state.positionTokenId!,
      poolKey: state.pool!.key,
      amount0Desired: state.amount0!,
      amount1Desired: state.amount1!,
      imports: state.imports,
    })
    const position = await client.getPosition({ positionTokenId: state.positionTokenId! })
    expect(position!.liquidity).toBeGreaterThan(state.liquidity!)
    state.liquidity = position!.liquidity
    // The increase respent the record; decrease must not build on the old one.
    state.recordTag = await waitForFreshRecord(state.recordTag)
  }, TX)

  it('decreases the whole position to owed balances', async () => {
    await client.decreaseLiquidity({
      positionTokenId: state.positionTokenId!,
      poolKey: state.pool!.key,
      liquidityToRemove: state.liquidity!,
    })
    const position = await client.getPosition({ positionTokenId: state.positionTokenId! })
    expect(position!.liquidity).toBe(0n)
    // Withdrawing does not pay out — it books what collect then pays.
    expect(position!.tokens_owed0 + position!.tokens_owed1).toBeGreaterThan(0n)
    state.recordTag = await waitForFreshRecord(state.recordTag)
  }, TX)

  it('collects the owed balances', async () => {
    // Collect asks for explicit amounts and pays the position's own withdrawal
    // address, so the request is built from what the decrease actually booked.
    const owed = (await client.getPosition({ positionTokenId: state.positionTokenId! }))!
    await client.collect({
      positionTokenId: state.positionTokenId!,
      poolKey: state.pool!.key,
      amount0Requested: owed.tokens_owed0,
      amount1Requested: owed.tokens_owed1,
      imports: state.imports,
    })
    const position = await client.getPosition({ positionTokenId: state.positionTokenId! })
    expect(position!.tokens_owed0).toBe(0n)
    expect(position!.tokens_owed1).toBe(0n)
    state.recordTag = await waitForFreshRecord(state.recordTag)
  }, TX)

  it('burns the emptied position', async () => {
    await client.burn({
      positionTokenId: state.positionTokenId!,
      poolKey: state.pool!.key,
    })
    // Both views lag the confirmation, by different mechanisms: the mapping
    // delete propagates to reads asynchronously, and the scanner has to notice
    // the NFT was spent. Asserting on the first read fails against a position
    // the chain has already removed — it read back with liquidity 0 seconds
    // after the burn confirmed, and null shortly after.
    let gone = false
    for (let i = 0; i < 40 && !gone; i++) {
      const [entry, owned] = await Promise.all([
        client.getPosition({ positionTokenId: state.positionTokenId! }),
        client.getOwnedPositions(),
      ])
      gone = entry === null && !owned.some((o) => o.positionTokenId === state.positionTokenId)
      if (!gone) await new Promise((r) => setTimeout(r, 5_000))
    }
    expect(gone, 'the burned position is still visible 200s after the burn confirmed').toBe(true)
  }, TX)
})
