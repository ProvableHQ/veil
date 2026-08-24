import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { parseTokenRecordInfo } from '../../src/utils/records.js'
import {
  setupAmmDevnode,
  ammV3SourceAvailable,
  AMM_PROGRAM,
  type AmmDevnode,
  type PoolInfo,
  type TokenInfo,
} from './devnodeAmm.js'

/**
 * Full `shield_swap.aleo` lifecycle against a compile-from-source devnode,
 * driven through the SDK write actions. The plain/plain pool exercises the
 * core AMM directly through the same call sites the wrapped flows use: mint,
 * increase_liquidity, both swap directions with claims, decrease_liquidity,
 * collect (including a collect whose withdrawal address differs from the
 * owner), and burn — asserting the on-chain mappings after every step.
 *
 * The wrapped-side matrix (wrapped/plain, wrapped/wrapped mint/increase/collect
 * and a wrapped-input swap) exercises the SDK's internal router dispatch. The
 * stack deploys, registers the wrapper→underlying bindings, and creates the
 * wrapped pools (asserted below).
 *
 * Gated behind VEIL_DEVNODE_INTEGRATION=1 and a resolvable amm-v3 checkout
 * (AMM_V3_ROOT or ~/dev/amm-v3); requires leo and aleo-devnode on PATH.
 *
 * Run with:
 *   VEIL_DEVNODE_INTEGRATION=1 npx vitest run \
 *     packages/shield-swap/test/integration/devnodeLifecycle.actions.e2e.test.ts
 */

const RUN = process.env.VEIL_DEVNODE_INTEGRATION === '1' && ammV3SourceAvailable()

/**
 * Formerly gated the wrapped-side matrix: the routed-liquidity and routed-swap
 * local paths read the public id (position token id / swap id) at a FIXED
 * output offset that assumed the LP router's leading underlying-change record
 * occupied output slot 0. On the devnode, veil-core's `extractTransitions`
 * drops router-forwarded external/dynamic records that carry no plaintext
 * value, so the public id landed at index 0 and those actions threw AFTER the
 * on-chain effect. The SDK now anchors on the public `field` output
 * (`requireFieldOutput`), so the offset no longer matters and the matrix runs.
 */
const WRAPPED_SDK_BLOCKED = false

/** Reads `liquidity`/`tokens_owed*` numbers out of a Position plaintext. */
function positionNumbers(plaintext: string): { liquidity: bigint; owed0: bigint; owed1: bigint } {
  const grab = (name: string) => {
    const m = plaintext.match(new RegExp(`${name}:\\s*(\\d+)u128`))
    if (!m) throw new Error(`No ${name} in position: ${plaintext}`)
    return BigInt(m[1]!)
  }
  return { liquidity: grab('liquidity'), owed0: grab('tokens_owed0'), owed1: grab('tokens_owed1') }
}

describe.runIf(RUN)('e2e: shield_swap lifecycle on devnode (SDK write actions)', () => {
  let ctx: AmmDevnode
  let dex: ReturnType<ReturnType<typeof shieldSwapActions>>

  const MINT = 20_000_000n

  // Plain/plain lifecycle handles.
  let nft: string
  let positionTokenId: string
  // Swap id from the plain/plain swap-and-claim test, kept for the
  // execution-receipt assertions that follow it.
  let lastSwapId: string

  beforeAll(async () => {
    ctx = await setupAmmDevnode()
    dex = ctx.user.walletClient.extend(shieldSwapActions({ program: AMM_PROGRAM })) as ReturnType<
      ReturnType<typeof shieldSwapActions>
    >
  }, 900_000)

  afterAll(async () => {
    await ctx?.stop()
  }, 60_000)

  /** Acquires a user-owned record for one pool side (underlying for wrappers). */
  async function sideRecord(token: TokenInfo, amount: bigint): Promise<string> {
    return token.wrapped
      ? ctx.mintUnderlyingToUser(token.underlyingProgram!, amount, token.underlyingWidth!)
      : ctx.mintPlainToUser(token.program, amount)
  }

  /** Re-reads a PositionNFT from a transaction, decrypted with `viewKey`. */
  async function nftFrom(viewKey: string, txId: string): Promise<string> {
    const records = await ctx.recordsOf(viewKey, txId)
    const found = records.find((r) => r.includes('tick_lower'))
    expect(found, `PositionNFT record in ${txId}`).toBeDefined()
    return found!
  }

  async function position(id: string) {
    const raw = await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'positions', key: id })
    expect(raw, `positions[${id}]`).toBeTruthy()
    return positionNumbers(String(raw))
  }

  it('bootstrap landed: fee tier, spacing, tokens allowed, three pools created', async () => {
    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'fee_tiers', key: `${ctx.fee}u16` })).toBe('true')
    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'tick_spacings', key: `${ctx.tickSpacing}u32` })).toBe('true')
    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'fee_to_tick_spacing', key: `${ctx.fee}u16` })).toBe(`${ctx.tickSpacing}u32`)
    // Plain token registered without a wrapper mapping; wrapper bound to its underlying.
    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'token_allowed', key: ctx.tokens.plainB.field })).toBe('true')
    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'from_wrapper_token_id', key: ctx.tokens.wcredits.field })).toBeTruthy()

    for (const pool of [ctx.pools.pp, ctx.pools.wp, ctx.pools.ww]) {
      expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'initialized_pools', key: pool.poolKey })).toBe('true')
      const slot = await dex.getSlot({ poolKey: pool.poolKey })
      expect(slot, `${pool.name}: slot exists`).toBeTruthy()
      expect(slot!.tick_spacing).toBe(ctx.tickSpacing)
    }
    // The plain pool is seeded so its swaps have depth.
    expect((await dex.getSlot({ poolKey: ctx.pools.pp.poolKey }))!.liquidity).toBeGreaterThan(0n)
  })

  it('mint opens a plain/plain position and the mappings carry it', async () => {
    const pool = ctx.pools.pp
    const record0 = await sideRecord(pool.token0, MINT)
    const record1 = await sideRecord(pool.token1, MINT)
    const result = await dex.mint({
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
    expect(result.positionTokenId).toMatch(/field$/)
    positionTokenId = result.positionTokenId!
    nft = await nftFrom(ctx.user.account.viewKey, result.transactionId)
    expect(nft).toMatch(new RegExp(`tick_lower:\\s*${-10 * ctx.tickSpacing}i32`))

    const pos = await position(positionTokenId)
    expect(pos.liquidity).toBeGreaterThan(0n)
  }, 240_000)

  it('increase_liquidity grows the plain/plain position', async () => {
    const pool = ctx.pools.pp
    const before = await position(positionTokenId)
    const record0 = await sideRecord(pool.token0, MINT)
    const record1 = await sideRecord(pool.token1, MINT)
    const result = await dex.increaseLiquidity({
      poolKey: pool.poolKey,
      amount0Desired: MINT / 4n,
      amount1Desired: MINT / 4n,
      positionRecord: nft,
      token0Record: record0,
      token1Record: record1,
      // Ticks already initialized — the MIN sentinel passes through.
      tickLowerHint: -400001,
      tickUpperHint: -400001,
      imports: ctx.imports,
    })
    nft = await nftFrom(ctx.user.account.viewKey, result.transactionId)
    expect((await position(positionTokenId)).liquidity).toBeGreaterThan(before.liquidity)
  }, 240_000)

  it('plain/plain swaps run both directions and claim their outputs (direct core dispatch)', async () => {
    const pool = ctx.pools.pp
    for (const zeroForOne of [true, false]) {
      const tokenIn = zeroForOne ? pool.token0 : pool.token1
      const slotBefore = await dex.getSlot({ poolKey: pool.poolKey })
      const tokenRecord = await sideRecord(tokenIn, MINT)

      const handle = await dex.swap({
        poolKey: pool.poolKey,
        tokenInId: tokenIn.field,
        amountIn: 2_000_000n,
        expectedOut: 0n,
        tokenRecord,
        imports: ctx.imports,
      })
      expect(handle.swapId).toMatch(/field$/)
      expect(handle.tokenInWrapped).toBe(false)
      lastSwapId = handle.swapId!

      const output = String(
        await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'swap_outputs', key: handle.swapId! }),
      )
      const chainAmountOut = BigInt(output.match(/amount_out:\s*(\d+)u128/)![1]!)
      expect(chainAmountOut).toBeGreaterThan(0n)

      const claim = await dex.claimSwapOutput({ handle, imports: ctx.imports })
      expect(claim.transactionId).toMatch(/^at1/)
      expect(claim.amountOut).toBe(chainAmountOut)

      const records = await ctx.recordsOf(ctx.user.account.viewKey, claim.transactionId)
      const paid = records.map((r) => parseTokenRecordInfo(r)).find((i) => i?.amount === chainAmountOut)
      expect(paid, `a claimed Token record of ${chainAmountOut}`).toBeDefined()

      const slotAfter = await dex.getSlot({ poolKey: pool.poolKey })
      if (zeroForOne) expect(slotAfter!.sqrt_price).toBeLessThan(slotBefore!.sqrt_price)
      else expect(slotAfter!.sqrt_price).toBeGreaterThan(slotBefore!.sqrt_price)
    }
  }, 480_000)

  it('the swap execution receipt and the pool creator round-trip against the devnode', async () => {
    // swap_execution receipts persist after the claim, so this reads the last
    // swap from the prior test at any point after it finalized — proving the
    // composite `{ swap_id, hop_index }` struct-key literal decodes against a
    // real node, which a unit test cannot exercise.
    const receipt = await dex.getSwapExecution({ swapId: lastSwapId })
    expect(receipt, 'swap execution receipt exists').toBeTruthy()
    expect(receipt!.header.hop_count).toBe(receipt!.hops.length)

    const hop = receipt!.hops[0]!
    expect(hop.amount_in).toBeGreaterThan(0n)
    expect(hop.lp_fee).toBe(hop.fee_paid - hop.protocol_fee)

    const creator = await dex.getPoolCreator({ poolKey: ctx.pools.pp.poolKey })
    expect(creator).toBe(ctx.admin.account.address)
  }, 120_000)

  it('decrease_liquidity settles owed and collect pays it out (plain/plain)', async () => {
    const pool = ctx.pools.pp
    const before = await position(positionTokenId)
    const dec = await dex.decreaseLiquidity({
      poolKey: pool.poolKey,
      liquidityToRemove: before.liquidity / 4n,
      positionRecord: nft,
    })
    nft = await nftFrom(ctx.user.account.viewKey, dec.transactionId)
    const afterDec = await position(positionTokenId)
    expect(afterDec.liquidity).toBe(before.liquidity - before.liquidity / 4n)
    expect(afterDec.owed0 + afterDec.owed1).toBeGreaterThan(0n)

    // tokens_owed folds lazily, so two passes fully drain.
    let paidOut = 0n
    for (let pass = 0; pass < 2; pass++) {
      const owed = await position(positionTokenId)
      if (owed.owed0 + owed.owed1 === 0n) break
      const result = await dex.collect({
        poolKey: pool.poolKey,
        amount0Requested: owed.owed0,
        amount1Requested: owed.owed1,
        positionRecord: nft,
        imports: ctx.imports,
      })
      const records = await ctx.recordsOf(ctx.user.account.viewKey, result.transactionId)
      for (const r of records) {
        const info = parseTokenRecordInfo(r)
        if (info) paidOut += info.amount
      }
      nft = await nftFrom(ctx.user.account.viewKey, result.transactionId)
    }
    const after = await position(positionTokenId)
    expect(after.owed0).toBe(0n)
    expect(after.owed1).toBe(0n)
    expect(paidOut).toBeGreaterThan(0n)
  }, 480_000)

  it('collect pays the position withdrawal address when it differs from the owner', async () => {
    // A plain/plain position owned by the user but paying out to a distinct cold
    // withdrawal address; the collect must pay that address, not the owner.
    const pool = ctx.pools.pp
    const withdrawalAccount = ctx.aleo.generateAccount()
    const record0 = await sideRecord(pool.token0, MINT)
    const record1 = await sideRecord(pool.token1, MINT)
    const minted = await dex.mint({
      poolKey: pool.poolKey,
      tickLower: -10 * ctx.tickSpacing,
      tickUpper: 10 * ctx.tickSpacing,
      amount0Desired: MINT / 2n,
      amount1Desired: MINT / 2n,
      recipient: ctx.user.account.address,
      withdrawal: withdrawalAccount.address,
      token0Record: record0,
      token1Record: record1,
      // Ticks already initialized by the earlier positions — hints pass through.
      tickLowerHint: -400001,
      tickUpperHint: -400001,
      imports: ctx.imports,
    })
    const id = minted.positionTokenId!
    const mintedNft = await nftFrom(ctx.user.account.viewKey, minted.transactionId)
    expect(mintedNft).toMatch(new RegExp(`withdrawal:\\s*${withdrawalAccount.address}`))

    const before = await position(id)
    const dec = await dex.decreaseLiquidity({ poolKey: pool.poolKey, liquidityToRemove: before.liquidity / 2n, positionRecord: mintedNft })
    const nft2 = await nftFrom(ctx.user.account.viewKey, dec.transactionId)
    const owed = await position(id)
    expect(owed.owed0 + owed.owed1).toBeGreaterThan(0n)

    const collected = await dex.collect({
      poolKey: pool.poolKey,
      amount0Requested: owed.owed0,
      amount1Requested: owed.owed1,
      positionRecord: nft2,
      imports: ctx.imports,
    })
    // The payout landed on the WITHDRAWAL account, not the owner.
    const withdrawalRecords = await ctx.recordsOf(withdrawalAccount.viewKey, collected.transactionId)
    const paidToWithdrawal = withdrawalRecords.map((r) => parseTokenRecordInfo(r)).some((i) => i && i.amount > 0n)
    expect(paidToWithdrawal, 'collect pays the withdrawal address').toBe(true)
  }, 480_000)

  it('decrease to zero then burn closes the plain/plain position directly', async () => {
    const pool = ctx.pools.pp
    const remaining = await position(positionTokenId)
    if (remaining.liquidity > 0n) {
      const dec = await dex.decreaseLiquidity({ poolKey: pool.poolKey, liquidityToRemove: remaining.liquidity, positionRecord: nft })
      nft = await nftFrom(ctx.user.account.viewKey, dec.transactionId)
    }
    const owed = await position(positionTokenId)
    if (owed.owed0 + owed.owed1 > 0n) {
      const col = await dex.collect({
        poolKey: pool.poolKey,
        amount0Requested: owed.owed0,
        amount1Requested: owed.owed1,
        positionRecord: nft,
        imports: ctx.imports,
      })
      nft = await nftFrom(ctx.user.account.viewKey, col.transactionId)
    }
    const result = await dex.burn({ poolKey: pool.poolKey, positionRecord: nft })
    expect(result.transactionId).toMatch(/^at1/)
    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'positions', key: positionTokenId })).toBeFalsy()
  }, 480_000)

  // ── Wrapped-side matrix (router dispatch). Drives the SDK's internal router
  // dispatch end to end: mint/increase/collect and a wrapped-input swap through
  // the LP and swap routers.
  describe.skipIf(WRAPPED_SDK_BLOCKED)('wrapped-side router dispatch', () => {
    /** Seeds a fresh position in a wrapped pool via the SDK's router dispatch. */
    async function mintWrapped(pool: PoolInfo): Promise<{ id: string; nft: string }> {
      const record0 = await sideRecord(pool.token0, MINT)
      const record1 = await sideRecord(pool.token1, MINT)
      const result = await dex.mint({
        poolKey: pool.poolKey,
        tickLower: -10 * ctx.tickSpacing,
        tickUpper: 10 * ctx.tickSpacing,
        amount0Desired: MINT / 2n,
        amount1Desired: MINT / 2n,
        recipient: ctx.user.account.address,
        withdrawal: ctx.user.account.address,
        token0Record: record0,
        token1Record: record1,
        proofs: ctx.proofs,
        imports: ctx.imports,
      })
      expect(result.positionTokenId).toMatch(/field$/)
      return { id: result.positionTokenId!, nft: await nftFrom(ctx.user.account.viewKey, result.transactionId) }
    }

    it('mint/increase/collect route through the LP router (wrapped/plain and wrapped/wrapped)', async () => {
      for (const pool of [ctx.pools.wp, ctx.pools.ww]) {
        const { id, nft: mintedNft } = await mintWrapped(pool)
        const afterMint = await position(id)
        expect(afterMint.liquidity, `${pool.name}: routed mint adds liquidity`).toBeGreaterThan(0n)

        const rec0 = await sideRecord(pool.token0, MINT)
        const rec1 = await sideRecord(pool.token1, MINT)
        const inc = await dex.increaseLiquidity({
          poolKey: pool.poolKey,
          amount0Desired: MINT / 4n,
          amount1Desired: MINT / 4n,
          positionRecord: mintedNft,
          token0Record: rec0,
          token1Record: rec1,
          tickLowerHint: -400001,
          tickUpperHint: -400001,
          proofs: ctx.proofs,
          imports: ctx.imports,
        })
        const nftAfterInc = await nftFrom(ctx.user.account.viewKey, inc.transactionId)
        expect((await position(id)).liquidity).toBeGreaterThan(afterMint.liquidity)

        const before = await position(id)
        const dec = await dex.decreaseLiquidity({ poolKey: pool.poolKey, liquidityToRemove: before.liquidity / 2n, positionRecord: nftAfterInc })
        const nftAfterDec = await nftFrom(ctx.user.account.viewKey, dec.transactionId)
        const owed = await position(id)
        expect(owed.owed0 + owed.owed1).toBeGreaterThan(0n)

        const collected = await dex.collect({
          poolKey: pool.poolKey,
          amount0Requested: owed.owed0,
          amount1Requested: owed.owed1,
          positionRecord: nftAfterDec,
          proofs: ctx.proofs,
          imports: ctx.imports,
        })
        // A wrapped side pays out the UNDERLYING asset's records.
        const records = await ctx.recordsOf(ctx.user.account.viewKey, collected.transactionId)
        expect(records.map((r) => parseTokenRecordInfo(r)).some((i) => i && i.amount > 0n)).toBe(true)
      }
    }, 900_000)

    it('a wrapped-input swap routes through the swap router and its claim routes too', async () => {
      const pool = ctx.pools.wp
      const wrappedSide = pool.token0.wrapped ? pool.token0 : pool.token1

      // Seed depth via the router mint first.
      await mintWrapped(pool)

      const tokenRecord = await sideRecord(wrappedSide, MINT)
      const handle = await dex.swap({
        poolKey: pool.poolKey,
        tokenInId: wrappedSide.field,
        amountIn: 2_000_000n,
        // The router asserts amount_out_min > 0.
        expectedOut: 1_000_000n,
        slippageBps: 5000,
        tokenRecord,
        proofs: ctx.proofs,
        imports: ctx.imports,
      })
      expect(handle.tokenInWrapped, 'wrapped input routes through the swap router').toBe(true)

      const output = String(
        await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'swap_outputs', key: handle.swapId! }),
      )
      const chainAmountOut = BigInt(output.match(/amount_out:\s*(\d+)u128/)![1]!)
      expect(chainAmountOut).toBeGreaterThan(0n)

      const claim = await dex.claimSwapOutput({ handle, proofs: ctx.proofs, imports: ctx.imports })
      expect(claim.transactionId).toMatch(/^at1/)
      expect(claim.amountOut).toBe(chainAmountOut)
    }, 900_000)
  })
})
