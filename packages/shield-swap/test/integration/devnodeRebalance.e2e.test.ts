import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { parseTokenRecordInfo } from '../../src/utils/records.js'
import {
  setupAmmDevnode,
  ammV3SourceAvailable,
  AMM_PROGRAM,
  type AmmDevnode,
} from './devnodeAmm.js'

/**
 * Rebalance lifecycle against a compile-from-source devnode.
 *
 * The sequence is chosen to prove the planner against the contract's own
 * recomputation: mint a plain/plain position, swap through its range so fees
 * accrue PAST the position's checkpoints (the mapping's `tokens_owed` stays
 * zero — only the finalize settles them), then rebalance. The zero-budget
 * rebalance passes only if `planRebalance` reproduced the close's full
 * settlement — principal, owed, and un-checkpointed fees — exactly; a funded
 * grow then exercises the funding-record path and the `_both` entrypoint.
 *
 * Gated behind VEIL_DEVNODE_INTEGRATION=1 and a resolvable amm-v3 checkout
 * (AMM_V3_ROOT or ~/dev/amm-v3); requires leo and aleo-devnode on PATH.
 *
 * Run with:
 *   VEIL_DEVNODE_INTEGRATION=1 npx vitest run \
 *     packages/shield-swap/test/integration/devnodeRebalance.e2e.test.ts
 */

const RUN = process.env.VEIL_DEVNODE_INTEGRATION === '1' && ammV3SourceAvailable()

describe.runIf(RUN)('e2e: rebalance on devnode (plan, zero-budget, funded grow)', () => {
  let ctx: AmmDevnode
  let dex: ReturnType<ReturnType<typeof shieldSwapActions>>

  const MINT = 20_000_000n

  // Handles threaded through the sequence.
  let nft: string
  let positionTokenId: string

  beforeAll(async () => {
    ctx = await setupAmmDevnode()
    dex = ctx.user.walletClient.extend(shieldSwapActions({ program: AMM_PROGRAM })) as ReturnType<
      ReturnType<typeof shieldSwapActions>
    >
  }, 900_000)

  afterAll(async () => {
    await ctx?.stop()
  })

  /** Re-reads a PositionNFT from a transaction, decrypted with the user's view key. */
  async function nftFrom(txId: string): Promise<string> {
    const records = await ctx.recordsOf(ctx.user.account.viewKey, txId)
    const found = records.find((r) => r.includes('tick_lower'))
    expect(found, `PositionNFT record in ${txId}`).toBeDefined()
    return found!
  }

  async function positionRaw(id: string): Promise<string | null> {
    const raw = await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'positions', key: id })
    return raw == null ? null : String(raw)
  }

  it('mints a position and accrues fees past its checkpoints with a swap', async () => {
    const pool = ctx.pools.pp
    const record0 = await ctx.mintPlainToUser(pool.token0.program, MINT)
    const record1 = await ctx.mintPlainToUser(pool.token1.program, MINT)
    const minted = await dex.mint({
      poolKey: pool.poolKey,
      tickLower: -10 * ctx.tickSpacing,
      tickUpper: 10 * ctx.tickSpacing,
      amount0Desired: MINT / 2n,
      amount1Desired: MINT / 2n,
      recipient: ctx.user.account.address,
      withdrawal: ctx.user.account.address,
      token0Record: record0,
      token1Record: record1,
      imports: ctx.imports,
    })
    positionTokenId = minted.positionTokenId!
    nft = await nftFrom(minted.transactionId)

    // Swap token0 in, through the position's range. The pool's fee lands in
    // fee growth immediately; the position's own `tokens_owed` mapping value
    // stays zero until something settles it — which is exactly the state the
    // planner must price correctly.
    const tokenRecord = await ctx.mintPlainToUser(pool.token0.program, MINT)
    const handle = await dex.swap({
      poolKey: pool.poolKey,
      tokenInId: pool.token0.field,
      amountIn: 2_000_000n,
      expectedOut: 0n,
      tokenRecord,
      imports: ctx.imports,
    })
    expect(handle.swapId).toMatch(/field$/)

    const raw = await positionRaw(positionTokenId)
    expect(raw).toMatch(/tokens_owed0:\s*0u128/)
  }, 480_000)

  it('plans with the accrued fees and rebalances on recovered funds alone', async () => {
    const pool = ctx.pools.pp
    // A narrower range around the current tick — the canonical recenter.
    const plan = await dex.planRebalance({
      poolKey: pool.poolKey,
      positionTokenId,
      tickLower: -5 * ctx.tickSpacing,
      tickUpper: 5 * ctx.tickSpacing,
      maxFunding0: 0n,
      maxFunding1: 0n,
    })
    // The live proof of the fee fix: the swap accrued token0 fees that no
    // mapping carries yet, and the planner must have found them on its own.
    expect(plan.feesAccrued0!).toBeGreaterThan(0n)
    expect(plan.recovered0).toBeGreaterThan(0n)
    expect(plan.funded0).toBe(0n)
    expect(plan.funded1).toBe(0n)
    expect(plan.functionName).toBe('rebalance_plain_plain_none')

    const result = await dex.rebalancePosition({
      ...plan,
      positionRecord: nft,
      imports: ctx.imports,
    })
    expect(result.positionTokenId).toMatch(/field$/)
    expect(result.positionTokenId).not.toBe(positionTokenId)

    // The old position is gone; the successor carries exactly the planned
    // liquidity with nothing owed — the contract asserted our numbers.
    expect(await positionRaw(positionTokenId)).toBeNull()
    const successor = await positionRaw(result.positionTokenId!)
    expect(successor).toMatch(new RegExp(`liquidity:\\s*${plan.liquidityTarget}u128`))
    expect(successor).toMatch(/tokens_owed0:\s*0u128/)
    expect(successor).toMatch(new RegExp(`tick_lower:\\s*${plan.tickLower}i32`))

    // Refund records land privately with the withdrawal address (the user).
    const records = await ctx.recordsOf(ctx.user.account.viewKey, result.transactionId)
    for (const [refund, token] of [
      [plan.refund0, pool.token0],
      [plan.refund1, pool.token1],
    ] as const) {
      if (refund === 0n) continue
      const paid = records.map((r) => parseTokenRecordInfo(r)).find((i) => i?.amount === refund)
      expect(paid, `a refund record of ${refund} for ${token.program}`).toBeDefined()
    }

    positionTokenId = result.positionTokenId!
    nft = await nftFrom(result.transactionId)
  }, 480_000)

  it('grows the position past its recovery with funding records', async () => {
    const pool = ctx.pools.pp
    const before = await positionRaw(positionTokenId)
    const liquidity = BigInt(before!.match(/liquidity:\s*(\d+)u128/)![1]!)

    const plan = await dex.planRebalance({
      poolKey: pool.poolKey,
      positionTokenId,
      tickLower: -5 * ctx.tickSpacing,
      tickUpper: 5 * ctx.tickSpacing,
      liquidityTarget: liquidity * 2n,
    })
    expect(plan.funded0).toBeGreaterThan(0n)
    expect(plan.funded1).toBeGreaterThan(0n)
    expect(plan.functionName).toBe('rebalance_plain_plain_both')

    const result = await dex.rebalancePosition({
      ...plan,
      positionRecord: nft,
      token0Record: await ctx.mintPlainToUser(pool.token0.program, plan.funded0 + MINT),
      token1Record: await ctx.mintPlainToUser(pool.token1.program, plan.funded1 + MINT),
      imports: ctx.imports,
    })

    expect(await positionRaw(positionTokenId)).toBeNull()
    const successor = await positionRaw(result.positionTokenId!)
    expect(successor).toMatch(new RegExp(`liquidity:\\s*${liquidity * 2n}u128`))
  }, 480_000)
})
