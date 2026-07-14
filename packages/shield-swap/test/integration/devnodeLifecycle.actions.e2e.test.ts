import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { parseTokenRecordInfo } from '../../src/utils/records.js'
import {
  derivePoolKey,
  deriveTickKey,
  deriveSwapId,
  derivePositionTokenId,
  deriveMultiHopSwapId,
} from '../../src/utils/keys.js'
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
 * PATH; the AMM sources are vendored fixtures (no live network).
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

  /**
   * Re-reads the user's PositionNFT from a transaction and stores it. On the
   * first mint it also checks the NFT carries the requested tick range, so a
   * malformed or wrong-ticks NFT is caught rather than passed through.
   */
  async function refreshNft(pool: PoolCase, txId: string) {
    const records = await ctx.recordsOf(ctx.user.account.viewKey, txId)
    const nft = records.find((r) => r.includes('tick_lower'))
    expect(nft, `PositionNFT record in ${txId}`).toBeDefined()
    if (pool.nftRecord === undefined) {
      expect(nft).toMatch(new RegExp(`tick_lower:\\s*${-10 * pool.tickSpacing}i32`))
      expect(nft).toMatch(new RegExp(`tick_upper:\\s*${10 * pool.tickSpacing}i32`))
    }
    pool.nftRecord = nft
  }

  async function position(pool: PoolCase) {
    const raw = await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'positions', key: pool.positionTokenId! })
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
    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'fee_tiers', key: '3000u16' })).toBe('true')
    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'fee_tiers', key: '500u16' })).toBe('true')
    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'tick_spacings', key: '60u32' })).toBe('true')
    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'fee_to_tick_spacing', key: '500u16' })).toBe('10u32')
    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'token_allowed', key: ctx.token0Field })).toBe('true')
    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'token_decimals', key: ctx.token1Field })).toBe('6u8')
    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'pool_creation_is_open', key: 'true' })).toBe('true')
    expect(String(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'admin', key: 'true' }))).toBe(ctx.admin.account.address)
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

      // Authoritative parity: the locally derived key must equal the one the
      // chain computed for these tokens + fee (BHP256 struct-hash parity).
      expect(await derivePoolKey({ token0: ctx.token0Field, token1: ctx.token1Field, fee: pool.fee })).toBe(poolKey)

      // Mapping state: pool registered with the requested fee/tokens, slot at
      // the initial tick, no liquidity.
      expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'initialized_pools', key: poolKey! })).toBe('true')
      const poolStruct = String(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'pools', key: poolKey! }))
      expect(poolStruct).toMatch(/enabled:\s*true/)
      expect(poolStruct).toMatch(new RegExp(`fee:\\s*${pool.fee}u16`))
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

      // Authoritative tick-key parity: the mint initialized tick_lower, so its
      // locally derived key must locate a real tick (i32 struct-hash parity).
      const tickLowerKey = await deriveTickKey({ pool: pool.poolKey!, tick: -10 * pool.tickSpacing })
      const tickEntry = await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'ticks', key: tickLowerKey })
      expect(tickEntry, `tick ${-10 * pool.tickSpacing} present via derived key`).toBeTruthy()

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

      // Authoritative id parity: the transition's first output equals the
      // local BHP256 SwapKey hash over the handle's own preimage fields.
      expect(
        await deriveSwapId({
          poolKey: pool.poolKey!,
          zeroForOne: handle.zeroForOne!,
          amountIn: handle.amountIn,
          sqrtPriceLimit: handle.sqrtPriceLimit!,
          blindedAddress: handle.blindedAddress!,
          nonce: handle.nonce!,
        }),
      ).toBe(handle.swapId)

      // The finalize computed the outcome into swap_outputs — read it fresh
      // from chain and parse the actual amount_out the contract produced.
      const output = String(
        await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'swap_outputs', key: handle.swapId! }),
      )
      const chainAmountOut = BigInt(output.match(/amount_out:\s*(\d+)u128/)![1]!)
      expect(chainAmountOut).toBeGreaterThan(0n)

      const claim = await dex.claimSwapOutput({ handle, imports: ctx.imports })
      expect(claim.transactionId).toMatch(/^at1/)
      // The SDK-reported amount must match the chain's own computation.
      expect(claim.amountOut).toBe(chainAmountOut)

      // The private output landed as a Token record whose decoded amount is
      // exactly the swap's output.
      const records = await ctx.recordsOf(ctx.user.account.viewKey, claim.transactionId)
      const paid = records.map((r) => parseTokenRecordInfo(r)).find((i) => i?.amount === chainAmountOut)
      expect(paid, `a claimed Token record of ${chainAmountOut}`).toBeDefined()

      // Price moved in the direction of the swap.
      const slotAfter = await dex.getSlot({ poolKey: pool.poolKey! })
      if (zeroForOne) expect(slotAfter!.sqrt_price).toBeLessThan(slotBefore!.sqrt_price)
      else expect(slotAfter!.sqrt_price).toBeGreaterThan(slotBefore!.sqrt_price)
    }
  }, 480_000)

  it('a repeat mint proves position token id parity (TokenIDPreimage hash)', async () => {
    const pool = pools[0]!
    const record0 = await privatizeToken(ctx.user, ctx.token0Program, 50_000_000n)
    const record1 = await privatizeToken(ctx.user, ctx.token1Program, 50_000_000n)
    const nonce = '424242field'
    // Same range as the first mint: the ticks are already initialized, so the
    // contract skips hint validation and the whole preimage is known here.
    const result = await dex.mint({
      poolKey: pool.poolKey!,
      tickLower: -10 * pool.tickSpacing,
      tickUpper: 10 * pool.tickSpacing,
      amount0Desired: 10_000_000n,
      amount1Desired: 10_000_000n,
      token0Record: record0,
      token1Record: record1,
      tickLowerHint: -400001,
      tickUpperHint: -400001,
      nonce,
      imports: ctx.imports,
    })
    expect(result.positionTokenId).toMatch(/field$/)

    // Authoritative id parity: transition output vs local TokenIDPreimage hash.
    expect(
      await derivePositionTokenId({
        request: {
          pool: pool.poolKey!,
          tickLower: -10 * pool.tickSpacing,
          tickUpper: 10 * pool.tickSpacing,
          amount0Desired: 10_000_000n,
          amount1Desired: 10_000_000n,
          amount0Min: 0n,
          amount1Min: 0n,
          tickLowerHint: -400001,
          tickUpperHint: -400001,
        },
        recipient: ctx.user.account.address,
        nonce,
      }),
    ).toBe(result.positionTokenId)
  }, 240_000)

  it('swap_multi_hop routes across both pools and claims the output', async () => {
    // The two pools share the token pair, so A →(pool0) B →(pool1) A is a
    // valid two-hop route — the round trip exercises direction resolution
    // in both orientations.
    const tokenRecord = await privatizeToken(ctx.user, ctx.token0Program, 20_000_000n)
    const handle = await dex.swapMultiHop({
      poolKeys: [pools[0]!.poolKey!, pools[1]!.poolKey!],
      tokenInId: ctx.token0Field,
      amountIn: 5_000_000n,
      expectedOut: 0n,
      tokenRecord,
      imports: ctx.imports,
    })
    expect(handle.swapId).toMatch(/field$/)
    expect(handle.tokenOutId).toBe(ctx.token0Field)
    expect(handle.hops.map((h) => h.zeroForOne)).toEqual([true, false])

    // Authoritative id parity: transition output vs local SwapMultiHopRequest
    // hash over the handle's own preimage fields (deadline included).
    expect(
      await deriveMultiHopSwapId({
        tokenInId: handle.tokenInId,
        tokenOutId: handle.tokenOutId,
        amountIn: handle.amountIn,
        amountOutMin: handle.amountOutMin,
        blindedAddress: handle.blindedAddress!,
        hops: handle.hops,
        nonce: handle.nonce,
        deadline: handle.deadline,
      }),
    ).toBe(handle.swapId)

    // The finalize computed the route outcome — claim it and check the
    // chain-computed amounts came back as records.
    const claim = await dex.claimMultiHopOutput({ handle, imports: ctx.imports })
    expect(claim.transactionId).toMatch(/^at1/)
    expect(claim.amountOut).toBeGreaterThan(0n)
    const records = await ctx.recordsOf(ctx.user.account.viewKey, claim.transactionId)
    const paid = records.map((r) => parseTokenRecordInfo(r)).find((i) => i?.amount === claim.amountOut)
    expect(paid, `a claimed Token record of ${claim.amountOut}`).toBeDefined()
  }, 480_000)

  it('collect pays out the owed tokens and clears them from the position', async () => {
    for (const pool of pools) {
      // tokens_owed updates lazily: the collect finalize first folds accrued
      // swap fees into owed, then pays the requested amounts — so one pass
      // leaves the freshly-folded fees behind. Two passes drain fully.
      let paidOut = 0n
      for (let pass = 0; pass < 2; pass++) {
        const owed = await position(pool)
        if (owed.owed0 + owed.owed1 === 0n) {
          // The position must actually owe something on the first pass —
          // otherwise a no-op collect would pass vacuously.
          if (pass === 0) throw new Error('collect precondition: position owes nothing')
          break
        }
        const result = await dex.collect({
          poolKey: pool.poolKey!,
          amount0Requested: owed.owed0,
          amount1Requested: owed.owed1,
          positionRecord: pool.nftRecord!,
          imports: ctx.imports,
        })
        // The owed tokens are paid out as Token records to the recipient —
        // decode them and total the amounts actually moved.
        const records = await ctx.recordsOf(ctx.user.account.viewKey, result.transactionId)
        for (const r of records) {
          const info = parseTokenRecordInfo(r)
          if (info) paidOut += info.amount
        }
        await refreshNft(pool, result.transactionId)
      }
      const after = await position(pool)
      expect(after.owed0).toBe(0n)
      expect(after.owed1).toBe(0n)
      // Owed didn't just get zeroed — tokens were actually paid out.
      expect(paidOut).toBeGreaterThan(0n)
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
      expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'positions', key: pool.positionTokenId! })).toBeFalsy()
    }
  }, 480_000)

  it('identifierToField matches the contract token-id encoding (golden)', () => {
    // Golden values: the little-endian byte encoding the AMM keys tokens by.
    // The lifecycle above already relies on these (pool creation, token_allowed
    // reads) — this pins the exact encoding so a regression is caught directly.
    expect(identifierToField('test_token_a')).toBe('30135415236709662781336675700field')
    expect(identifierToField('test_token_b')).toBe('30444900246531007850061456756field')
  })
})
