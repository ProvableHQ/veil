import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import {
  setupAmmDevnode,
  privatizeToken,
  identifierToField,
  AMM_PROGRAM,
  type AmmDevnode,
} from './devnodeAmm.js'

/**
 * Full AMM v3 lifecycle against a devnode, driven through the shield-swap
 * SDK's write actions: a non-admin user creates two pools (same pair, two
 * fee tiers), mints and resizes positions, swaps both directions and claims
 * the outputs, collects earnings, and burns out of the positions — with the
 * on-chain mappings asserted after every step. The companion suite
 * devnodeLifecycle.generated.e2e.test.ts runs the same scenario through the
 * generated contract bindings.
 *
 * Gated behind VEIL_DEVNODE_INTEGRATION=1: requires leo and aleo-devnode on
 * PATH, and fetches the deployed AMM source from the live testnet API.
 *
 * Run with:
 *   VEIL_DEVNODE_INTEGRATION=1 npx vitest run packages/shield-swap/test/integration/devnodeLifecycle.actions.e2e.test.ts
 */

const RUN = process.env.VEIL_DEVNODE_INTEGRATION === '1'

type PoolCase = {
  fee: number
  tickSpacing: number
  poolKey?: string
  positionTokenId?: string
  nftRecord?: string
}

/** Reads `liquidity`/`tokens_owed*` numbers out of a Position plaintext. */
function positionNumbers(plaintext: string): { liquidity: bigint; owed0: bigint; owed1: bigint } {
  const grab = (name: string) => {
    const m = plaintext.match(new RegExp(`${name}:\\s*(\\d+)u128`))
    if (!m) throw new Error(`No ${name} in position: ${plaintext}`)
    return BigInt(m[1]!)
  }
  return { liquidity: grab('liquidity'), owed0: grab('tokens_owed0'), owed1: grab('tokens_owed1') }
}

describe.runIf(RUN)('e2e: AMM v3 lifecycle on devnode (SDK write actions)', () => {
  let ctx: AmmDevnode
  let dex: ReturnType<ReturnType<typeof shieldSwapActions>>
  const pools: PoolCase[] = [
    { fee: 3000, tickSpacing: 60 },
    { fee: 500, tickSpacing: 10 },
  ]

  /** Re-reads the user's PositionNFT from a transaction and stores it on the pool case. */
  async function refreshNft(pool: PoolCase, txId: string) {
    const records = await ctx.recordsOf(ctx.user.account.viewKey, txId)
    const nft = records.find((r) => r.includes('tick_lower'))
    expect(nft, `PositionNFT record in ${txId}`).toBeDefined()
    pool.nftRecord = nft
  }

  async function position(pool: PoolCase) {
    const raw = await ctx.readMapping('positions', pool.positionTokenId!)
    expect(raw, `positions[${pool.positionTokenId}]`).toBeTruthy()
    return positionNumbers(String(raw))
  }

  beforeAll(async () => {
    ctx = await setupAmmDevnode()
    dex = ctx.user.walletClient.extend(shieldSwapActions({ api: {}, program: AMM_PROGRAM })) as any
  }, 600_000)

  afterAll(async () => {
    await ctx?.stop()
  }, 60_000)

  it('admin setup landed: fee tiers, spacings, tokens, open pool creation', async () => {
    expect(await ctx.readMapping('fee_tiers', '3000u16')).toBe('true')
    expect(await ctx.readMapping('fee_tiers', '500u16')).toBe('true')
    expect(await ctx.readMapping('tick_spacings', '60u32')).toBe('true')
    expect(await ctx.readMapping('fee_to_tick_spacing', '500u16')).toBe('10u32')
    expect(await ctx.readMapping('token_allowed', ctx.token0Field)).toBe('true')
    expect(await ctx.readMapping('token_decimals', ctx.token1Field)).toBe('6u8')
    expect(await ctx.readMapping('pool_creation_is_open', 'true')).toBe('true')
    expect(String(await ctx.readMapping('admin', 'true'))).toBe(ctx.admin.account.address)
  })

  it('a non-admin creates two pools over the same pair at distinct fee tiers', async () => {
    for (const pool of pools) {
      // Despite the parameter names, createPool takes the token *field ids*.
      const { poolKey, transactionId } = await dex.createPool({
        token0ProgramId: ctx.token0Field,
        token1ProgramId: ctx.token1Field,
        fee: pool.fee,
        initialTick: 0,
        imports: ctx.imports,
      })
      expect(transactionId).toMatch(/^at1/)
      expect(poolKey).toMatch(/field$/)
      pool.poolKey = poolKey

      // Mapping state: pool registered, slot at the initial tick, no liquidity.
      expect(await ctx.readMapping('initialized_pools', poolKey!)).toBe('true')
      expect(await ctx.readMapping('pools', poolKey!)).toBeTruthy()
      const slot = await dex.getSlot({ poolKey: poolKey! })
      expect(slot).toBeTruthy()
      expect(slot!.tick).toBe(0)
      expect(slot!.tick_spacing).toBe(pool.tickSpacing)
      expect(slot!.liquidity).toBe(0n)
    }
    expect(pools[0]!.poolKey).not.toBe(pools[1]!.poolKey)
  }, 240_000)

  it('mint opens a position in each pool and the mappings carry it', async () => {
    for (const pool of pools) {
      const record0 = await privatizeToken(ctx.user, ctx.token0Program, 200_000_000n)
      const record1 = await privatizeToken(ctx.user, ctx.token1Program, 200_000_000n)
      const result = await dex.mint({
        poolKey: pool.poolKey!,
        tickLower: -10 * pool.tickSpacing,
        tickUpper: 10 * pool.tickSpacing,
        amount0Desired: 100_000_000n,
        amount1Desired: 100_000_000n,
        token0Record: record0,
        token1Record: record1,
        imports: ctx.imports,
      })
      expect(result.positionTokenId).toMatch(/field$/)
      pool.positionTokenId = result.positionTokenId
      await refreshNft(pool, result.transactionId)

      const pos = await position(pool)
      expect(pos.liquidity).toBeGreaterThan(0n)
      const slot = await dex.getSlot({ poolKey: pool.poolKey! })
      expect(slot!.liquidity).toBe(pos.liquidity)
    }
  }, 240_000)

  it('increase_liquidity grows the position', async () => {
    for (const pool of pools) {
      const before = await position(pool)
      const record0 = await privatizeToken(ctx.user, ctx.token0Program, 100_000_000n)
      const record1 = await privatizeToken(ctx.user, ctx.token1Program, 100_000_000n)
      const result = await dex.increaseLiquidity({
        poolKey: pool.poolKey!,
        amount0Desired: 50_000_000n,
        amount1Desired: 50_000_000n,
        positionRecord: pool.nftRecord!,
        token0Record: record0,
        token1Record: record1,
        // The position's ticks are already initialized, so the contract
        // skips hint validation — the MIN sentinel passes through.
        tickLowerHint: -400001,
        tickUpperHint: -400001,
        imports: ctx.imports,
      })
      await refreshNft(pool, result.transactionId)
      const after = await position(pool)
      expect(after.liquidity).toBeGreaterThan(before.liquidity)
    }
  }, 240_000)

  it('decrease_liquidity shrinks the position and settles owed tokens', async () => {
    for (const pool of pools) {
      const before = await position(pool)
      const result = await dex.decreaseLiquidity({
        poolKey: pool.poolKey!,
        liquidityToRemove: before.liquidity / 4n,
        positionRecord: pool.nftRecord!,
      })
      await refreshNft(pool, result.transactionId)
      const after = await position(pool)
      expect(after.liquidity).toBe(before.liquidity - before.liquidity / 4n)
      // Withdrawn amounts settle into tokens_owed until collected.
      expect(after.owed0 + after.owed1).toBeGreaterThan(0n)
    }
  }, 240_000)

  it('swaps run both directions and claim their outputs', async () => {
    const pool = pools[0]!
    for (const zeroForOne of [true, false]) {
      const tokenInProgram = zeroForOne ? ctx.token0Program : ctx.token1Program
      const tokenInId = zeroForOne ? ctx.token0Field : ctx.token1Field
      const slotBefore = await dex.getSlot({ poolKey: pool.poolKey! })
      const tokenRecord = await privatizeToken(ctx.user, tokenInProgram, 20_000_000n)

      const handle = await dex.swap({
        poolKey: pool.poolKey!,
        tokenInId,
        amountIn: 10_000_000n,
        // A 10M swap against ~150M of liquidity moves the price a lot; pin
        // the floor at zero like the reference e2e and assert on the actual
        // claimed amount instead.
        expectedOut: 0n,
        tokenRecord,
        imports: ctx.imports,
      })
      expect(handle.swapId).toMatch(/field$/)

      // The finalize wrote the outcome into swap_outputs before the claim.
      const output = await ctx.readMapping('swap_outputs', handle.swapId!)
      expect(output).toBeTruthy()

      const claim = await dex.claimSwapOutput({ handle, imports: ctx.imports })
      expect(claim.transactionId).toMatch(/^at1/)
      expect(claim.amountOut).toBeGreaterThan(0n)

      // The private output landed as Token records for the signer.
      const records = await ctx.recordsOf(ctx.user.account.viewKey, claim.transactionId)
      expect(records.some((r) => r.includes('amount'))).toBe(true)

      // Price moved in the direction of the swap.
      const slotAfter = await dex.getSlot({ poolKey: pool.poolKey! })
      if (zeroForOne) expect(slotAfter!.sqrt_price).toBeLessThan(slotBefore!.sqrt_price)
      else expect(slotAfter!.sqrt_price).toBeGreaterThan(slotBefore!.sqrt_price)
    }
  }, 480_000)

  it('collect pays out the owed tokens and clears them from the position', async () => {
    for (const pool of pools) {
      // tokens_owed updates lazily: the collect finalize first folds accrued
      // swap fees into owed, then pays the requested amounts — so one pass
      // leaves the freshly-folded fees behind. Two passes drain fully.
      for (let pass = 0; pass < 2; pass++) {
        const owed = await position(pool)
        if (owed.owed0 + owed.owed1 === 0n && pass > 0) break
        const result = await dex.collect({
          poolKey: pool.poolKey!,
          amount0Requested: owed.owed0,
          amount1Requested: owed.owed1,
          positionRecord: pool.nftRecord!,
          imports: ctx.imports,
        })
        await refreshNft(pool, result.transactionId)
      }
      const after = await position(pool)
      expect(after.owed0).toBe(0n)
      expect(after.owed1).toBe(0n)
    }
  }, 240_000)

  it('burn exits the positions once liquidity and owed are zero', async () => {
    for (const pool of pools) {
      // The contract requires an empty position: drain remaining liquidity,
      // collect what that settles, then burn.
      const remaining = await position(pool)
      if (remaining.liquidity > 0n) {
        const dec = await dex.decreaseLiquidity({
          poolKey: pool.poolKey!,
          liquidityToRemove: remaining.liquidity,
          positionRecord: pool.nftRecord!,
        })
        await refreshNft(pool, dec.transactionId)
      }
      const owed = await position(pool)
      if (owed.owed0 + owed.owed1 > 0n) {
        const col = await dex.collect({
          poolKey: pool.poolKey!,
          amount0Requested: owed.owed0,
          amount1Requested: owed.owed1,
          positionRecord: pool.nftRecord!,
          imports: ctx.imports,
        })
        await refreshNft(pool, col.transactionId)
      }

      const result = await dex.burn({ poolKey: pool.poolKey!, positionRecord: pool.nftRecord! })
      expect(result.transactionId).toMatch(/^at1/)
      // The position mapping entry is removed by the burn finalize.
      expect(await ctx.readMapping('positions', pool.positionTokenId!)).toBeFalsy()
    }
  }, 480_000)

  it('token field ids derive from program identifiers', () => {
    // Sanity on the key encoding the suite relies on for mapping reads.
    expect(ctx.token0Field).toMatch(/field$/)
    expect(identifierToField('test_token_a')).not.toBe(identifierToField('test_token_b'))
  })
})
