import { describe, it, expect, beforeAll } from 'vitest'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { resolveDexImports } from '../../src/utils/imports.js'
import { amountsForLiquidity, getSqrtPriceAtTickX128 } from '../../src/utils/q128.js'
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
    amount0?: bigint
    amount1?: bigint
    positionTokenId?: string
    liquidity?: bigint
  } = {}

  /**
   * Waits for the record scanner to index the position NFT.
   *
   * The mint confirms before its output record is scanned, and every later
   * operation spends that record — so without this they fail with "mint a
   * position first" against a position that demonstrably exists on chain.
   */
  const waitForPositionRecord = async (positionTokenId: string) => {
    for (let i = 0; i < 40; i++) {
      const owned = await client.getOwnedPositions()
      if (owned.some((o) => o.positionTokenId === positionTokenId)) return true
      await new Promise((r) => setTimeout(r, 5_000))
    }
    return false
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
    // Spacing is read from the fee tier rather than assumed: the mapping from
    // fee to spacing is a chain-side registry, not a constant in this SDK.
    const spacing = await client.getFeeToTickSpacing({ fee: onchain!.fee })
    expect(spacing).toBeGreaterThan(0)

    const aligned = roundTickToSpacing(slot!.tick, spacing!)
    const tickLower = aligned - spacing! * 10
    const tickUpper = aligned + spacing! * 10
    state.tickLower = tickLower
    state.tickUpper = tickUpper
    expect(Math.abs(tickLower % spacing!)).toBe(0)
    expect(Math.abs(tickUpper % spacing!)).toBe(0)

    // Amounts are derived from the range at the current price. Fixed amounts
    // only balance for one pool's price and revert elsewhere as one side falls
    // short of the liquidity the range requires.
    const { amount0, amount1 } = amountsForLiquidity(
      slot!.sqrt_price,
      getSqrtPriceAtTickX128(tickLower),
      getSqrtPriceAtTickX128(tickUpper),
      10n ** 7n,
      true,
    )
    state.amount0 = amount0
    state.amount1 = amount1
    expect(amount0 + amount1).toBeGreaterThan(0n)
    // Straddling the active tick means the position is in range and earns fees.
    expect(tickLower).toBeLessThan(slot!.tick)
    expect(tickUpper).toBeGreaterThan(slot!.tick)
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
    const poolKey = state.pool!.key
    const [tickLowerHint, tickUpperHint] = await Promise.all([
      client.pickInsertHint({ poolKey, targetTick: state.tickLower! }),
      client.pickInsertHint({ poolKey, targetTick: state.tickUpper! }),
    ])

    const minted = await client.mint({
      poolKey,
      tickLower: state.tickLower!,
      tickUpper: state.tickUpper!,
      tickLowerHint,
      tickUpperHint,
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
    state.liquidity = position!.liquidity
  }, TX)

  it('lists the new position through the owned-position reads', async () => {
    expect(await waitForPositionRecord(state.positionTokenId!)).toBe(true)
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
  }, TX)

  it('burns the emptied position', async () => {
    await client.burn({
      positionTokenId: state.positionTokenId!,
      poolKey: state.pool!.key,
    })
    expect(await client.getPosition({ positionTokenId: state.positionTokenId! })).toBeNull()
    const owned = await client.getOwnedPositions()
    expect(owned.some((o) => o.positionTokenId === state.positionTokenId)).toBe(false)
  }, TX)
})
