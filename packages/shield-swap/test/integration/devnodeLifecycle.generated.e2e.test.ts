import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { createShieldSwapV3Contract } from '../../src/generated/shield_swap.js'
import { formatMintPositionRequest } from '../../src/actions/liquidity/mint.js'
import { nextBlindedIdentity, viewKeyToScalar } from '../../src/utils/blinding/identity.js'
import { getSqrtPriceAtTick, MIN_SQRT_PRICE, MAX_SQRT_PRICE } from '../../src/utils/tick-math.js'
import { generateFieldNonce } from '../../src/utils/params.js'
import { parseTokenRecordInfo } from '../../src/utils/records.js'
import {
  setupAmmDevnode,
  privatizeToken,
  AMM_PROGRAM,
  type AmmDevnode,
} from './devnodeAmm.js'

/**
 * The same AMM v3 lifecycle as devnodeLifecycle.actions.e2e.test.ts, driven
 * through the generated contract bindings instead of the write actions: raw
 * transition arguments, manual struct literals, explicit tick hints, and a
 * manually derived blinded identity for the swap pair. Between them the two
 * suites pin both public write surfaces of the package to the same on-chain
 * behavior.
 *
 * Gated behind VEIL_DEVNODE_INTEGRATION=1: requires leo and aleo-devnode on
 * PATH; the AMM sources are vendored fixtures (no live network).
 *
 * Run with:
 *   VEIL_DEVNODE_INTEGRATION=1 npx vitest run packages/shield-swap/test/integration/devnodeLifecycle.generated.e2e.test.ts
 */

const RUN = process.env.VEIL_DEVNODE_INTEGRATION === '1'

/** MIN tick-list sentinel — the insert hint for an empty neighborhood. */
const MIN_SENTINEL = '-400001i32'

/** Finds the first field literal in a generated execute result. */
function firstField(result: unknown): string {
  const flat = Array.isArray(result) ? result : [result]
  const field = flat.find((v): v is string => typeof v === 'string' && /^\d+field$/.test(v))
  if (!field) throw new Error(`No field literal in result: ${JSON.stringify(result)}`)
  return field
}

/** Pulls a named literal value out of a struct plaintext. */
function structValue(plaintext: string, name: string): string {
  const m = plaintext.match(new RegExp(`${name}:\\s*([^,\\n}]+)`))
  if (!m) throw new Error(`No ${name} in: ${plaintext}`)
  return m[1]!.trim()
}

describe.runIf(RUN)('e2e: AMM v3 lifecycle on devnode (generated contract)', () => {
  let ctx: AmmDevnode
  let contract: any
  const FEE = '3000u16'
  const TICK_SPACING = 60
  let poolKey: string
  let positionTokenId: string
  let nftRecord: string

  async function refreshNft(txId: string) {
    const records = await ctx.recordsOf(ctx.user.account.viewKey, txId)
    const nft = records.find((r) => r.includes('tick_lower'))
    expect(nft, `PositionNFT record in ${txId}`).toBeDefined()
    nftRecord = nft!
  }

  async function positionNumbers() {
    const raw = String(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'positions', key: positionTokenId }))
    const grab = (name: string) => BigInt(structValue(raw, name).replace('u128', ''))
    return { liquidity: grab('liquidity'), owed0: grab('tokens_owed0'), owed1: grab('tokens_owed1') }
  }

  async function deadline(): Promise<string> {
    const height = await ctx.user.publicClient.getBlockNumber()
    return `${Number(height) + 100}u32`
  }

  beforeAll(async () => {
    ctx = await setupAmmDevnode()
    contract = createShieldSwapV3Contract({
      publicClient: ctx.user.publicClient,
      walletClient: ctx.user.walletClient,
      imports: ctx.imports,
    })
  }, 600_000)

  afterAll(async () => {
    await ctx?.stop()
  }, 60_000)

  it('create_pool registers the pool and its slot', async () => {
    const { transactionId, result } = await contract.execute.create_pool({
      arg0: ctx.token0Field,
      arg1: ctx.token1Field,
      arg2: FEE,
      arg3: `${getSqrtPriceAtTick(0)}u128`,
      arg4: `${TICK_SPACING}u32`,
      arg5: '0i32',
    })
    expect(transactionId).toMatch(/^at1/)
    poolKey = firstField(result)

    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'initialized_pools', key: poolKey })).toBe('true')
    const pool = String(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'pools', key: poolKey }))
    expect(structValue(pool, 'enabled')).toBe('true')
    expect(structValue(pool, 'fee')).toBe(FEE)
    const slot = String(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'slots', key: poolKey }))
    expect(structValue(slot, 'tick')).toBe('0i32')
    expect(structValue(slot, 'tick_spacing')).toBe(`${TICK_SPACING}u32`)
    expect(structValue(slot, 'liquidity')).toBe('0u128')
  }, 240_000)

  it('mint opens a position through raw transition arguments', async () => {
    const record0 = await privatizeToken(ctx.user, ctx.token0Program, 200_000_000n)
    const record1 = await privatizeToken(ctx.user, ctx.token1Program, 200_000_000n)
    const tickLower = -10 * TICK_SPACING
    const tickUpper = 10 * TICK_SPACING
    const request = formatMintPositionRequest({
      pool: poolKey,
      tickLower,
      tickUpper,
      amount0Desired: 100_000_000n,
      amount1Desired: 100_000_000n,
      amount0Min: 0n,
      amount1Min: 0n,
      // Empty tick list: the lower tick's predecessor is the MIN sentinel;
      // the upper tick's predecessor is the lower tick, inserted first
      // within the same finalize.
      tickLowerHint: -400001,
      tickUpperHint: tickLower,
    })
    const { transactionId, result } = await contract.execute.mint({
      arg0: generateFieldNonce(),
      arg1: record0,
      arg2: record1,
      arg3: ctx.user.account.address,
      arg4: request,
      arg5: ctx.token0Field,
      arg6: ctx.token1Field,
    })
    positionTokenId = firstField(result)
    await refreshNft(transactionId)

    const pos = await positionNumbers()
    expect(pos.liquidity).toBeGreaterThan(0n)
    const slot = String(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'slots', key: poolKey }))
    expect(structValue(slot, 'liquidity')).toBe(`${pos.liquidity}u128`)
  }, 240_000)

  it('increase_liquidity grows the position', async () => {
    const before = await positionNumbers()
    const record0 = await privatizeToken(ctx.user, ctx.token0Program, 100_000_000n)
    const record1 = await privatizeToken(ctx.user, ctx.token1Program, 100_000_000n)
    const { transactionId } = await contract.execute.increase_liquidity({
      arg0: nftRecord,
      arg1: record0,
      arg2: record1,
      arg3: '50000000u128',
      arg4: '50000000u128',
      arg5: '0u128',
      arg6: '0u128',
      arg7: ctx.token0Field,
      arg8: ctx.token1Field,
      // Both ticks are already initialized — hints pass through unchecked.
      arg9: MIN_SENTINEL,
      arg10: MIN_SENTINEL,
    })
    await refreshNft(transactionId)
    expect((await positionNumbers()).liquidity).toBeGreaterThan(before.liquidity)
  }, 240_000)

  it('decrease_liquidity settles the withdrawn amounts as owed', async () => {
    const before = await positionNumbers()
    const remove = before.liquidity / 4n
    const { transactionId } = await contract.execute.decrease_liquidity({
      arg0: nftRecord,
      arg1: `${remove}u128`,
      arg2: '0u128',
      arg3: '0u128',
    })
    await refreshNft(transactionId)
    const after = await positionNumbers()
    expect(after.liquidity).toBe(before.liquidity - remove)
    expect(after.owed0 + after.owed1).toBeGreaterThan(0n)
  }, 240_000)

  it('swap and claim_swap_output move tokens with a manually blinded identity', async () => {
    for (const zeroForOne of [true, false]) {
      const tokenInProgram = zeroForOne ? ctx.token0Program : ctx.token1Program
      const tokenRecord = await privatizeToken(ctx.user, tokenInProgram, 20_000_000n)
      const slotBefore = String(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'slots', key: poolKey }))

      const identity = await nextBlindedIdentity(ctx.user.walletClient, {
        viewKeyScalar: await viewKeyToScalar(ctx.user.account.viewKey),
        signer: ctx.user.account.address,
        program: AMM_PROGRAM,
      })

      const { result } = await contract.execute.swap({
        arg0: tokenRecord,
        arg1: identity.blindingFactor,
        arg2: identity.blindedAddress,
        arg3: poolKey,
        arg4: zeroForOne ? 'true' : 'false',
        arg5: '10000000u128',
        arg6: '0u128',
        arg7: `${zeroForOne ? MIN_SQRT_PRICE : MAX_SQRT_PRICE}u128`,
        arg8: `${Date.now()}u64`,
        arg9: await deadline(),
        arg10: ctx.token0Field,
        arg11: ctx.token1Field,
      })
      const swapId = firstField(result)

      // The finalize computed the outcome into swap_outputs; the claim quotes
      // it back verbatim with the same blinded pair.
      const output = String(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'swap_outputs', key: swapId }))
      const amountOut = structValue(output, 'amount_out')
      const chainAmountOut = BigInt(amountOut.replace('u128', ''))
      expect(chainAmountOut).toBeGreaterThan(0n)

      const claim = await contract.execute.claim_swap_output({
        arg0: identity.blindingFactor,
        arg1: identity.blindedAddress,
        arg2: swapId,
        arg3: structValue(output, 'token_in'),
        arg4: structValue(output, 'token_out'),
        arg5: amountOut,
        arg6: structValue(output, 'amount_remaining'),
      })
      expect(claim.transactionId).toMatch(/^at1/)
      // The claimed Token record's decoded amount is exactly the swap output.
      const records = await ctx.recordsOf(ctx.user.account.viewKey, claim.transactionId)
      const paid = records.map((r) => parseTokenRecordInfo(r)).find((i) => i?.amount === chainAmountOut)
      expect(paid, `a claimed Token record of ${chainAmountOut}`).toBeDefined()

      // Price moved in the direction of the swap.
      const slotAfter = String(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'slots', key: poolKey }))
      const priceBefore = BigInt(structValue(slotBefore, 'sqrt_price').replace('u128', ''))
      const priceAfter = BigInt(structValue(slotAfter, 'sqrt_price').replace('u128', ''))
      if (zeroForOne) expect(priceAfter).toBeLessThan(priceBefore)
      else expect(priceAfter).toBeGreaterThan(priceBefore)
    }
  }, 480_000)

  it('collect drains the owed amounts and pays them out', async () => {
    // Two passes: the first collect folds accrued swap fees into owed while
    // paying the requested amounts; the second drains the folded remainder.
    let paidOut = 0n
    for (let pass = 0; pass < 2; pass++) {
      const owed = await positionNumbers()
      if (owed.owed0 + owed.owed1 === 0n) {
        if (pass === 0) throw new Error('collect precondition: position owes nothing')
        break
      }
      const { transactionId } = await contract.execute.collect({
        arg0: nftRecord,
        arg1: `${owed.owed0}u128`,
        arg2: `${owed.owed1}u128`,
        arg3: ctx.token0Field,
        arg4: ctx.token1Field,
        arg5: ctx.user.account.address,
      })
      // The owed tokens are paid out as Token records — total what moved.
      const records = await ctx.recordsOf(ctx.user.account.viewKey, transactionId)
      for (const r of records) {
        const info = parseTokenRecordInfo(r)
        if (info) paidOut += info.amount
      }
      await refreshNft(transactionId)
    }
    const after = await positionNumbers()
    expect(after.owed0).toBe(0n)
    expect(after.owed1).toBe(0n)
    expect(paidOut).toBeGreaterThan(0n)
  }, 240_000)

  it('burn removes the emptied position', async () => {
    const remaining = await positionNumbers()
    if (remaining.liquidity > 0n) {
      const { transactionId } = await contract.execute.decrease_liquidity({
        arg0: nftRecord,
        arg1: `${remaining.liquidity}u128`,
        arg2: '0u128',
        arg3: '0u128',
      })
      await refreshNft(transactionId)
    }
    const owed = await positionNumbers()
    if (owed.owed0 + owed.owed1 > 0n) {
      const { transactionId } = await contract.execute.collect({
        arg0: nftRecord,
        arg1: `${owed.owed0}u128`,
        arg2: `${owed.owed1}u128`,
        arg3: ctx.token0Field,
        arg4: ctx.token1Field,
        arg5: ctx.user.account.address,
      })
      await refreshNft(transactionId)
    }

    const { transactionId } = await contract.execute.burn({ arg0: nftRecord })
    expect(transactionId).toMatch(/^at1/)
    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'positions', key: positionTokenId })).toBeFalsy()
  }, 240_000)
})
