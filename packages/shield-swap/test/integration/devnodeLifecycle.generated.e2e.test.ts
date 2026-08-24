import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { createShieldSwapContract } from '../../src/generated/shield_swap.js'
import { formatMintPositionRequest, generateFieldNonce } from '../../src/utils/params.js'
import { nextBlindedIdentity, viewKeyToScalar } from '../../src/utils/blinding/identity.js'
import {
  getSqrtPriceAtTickX128,
  formatU256Literal,
  MIN_SQRT_RATIO_X128,
  MAX_SQRT_RATIO_X128,
} from '../../src/utils/q128.js'
import { EMPTY_MERKLE_PROOFS, formatMerkleProofPair } from '../../src/utils/proofs.js'
import { requireFieldOutput } from '../../src/utils/outputs.js'
import { parseTokenRecordInfo } from '../../src/utils/records.js'
import {
  setupAmmDevnode,
  ammV3SourceAvailable,
  AMM_PROGRAM,
  type AmmDevnode,
  type TokenInfo,
} from './devnodeAmm.js'

/**
 * The same core `shield_swap.aleo` lifecycle as the actions suite, driven
 * through the generated contract bindings with raw transition arguments: the
 * `create_pool` sqrt price as the `{ hi, lo }` U256 struct literal, the mint
 * freezelist proofs and the claim's non-inclusion witness as `[MerkleProof; 2]`
 * literals, and a manually blinded identity for the swap pair. Exercises the
 * plain/plain core dispatch only — the generated bindings call the AMM
 * directly, so wrapped routing (the actions suite) is out of scope here.
 * Between them the two suites pin both public write surfaces to the same
 * on-chain behavior.
 *
 * Gated behind VEIL_DEVNODE_INTEGRATION=1 and a resolvable amm-v3 checkout.
 *
 * Run with:
 *   VEIL_DEVNODE_INTEGRATION=1 npx vitest run \
 *     packages/shield-swap/test/integration/devnodeLifecycle.generated.e2e.test.ts
 */

const RUN = process.env.VEIL_DEVNODE_INTEGRATION === '1' && ammV3SourceAvailable()

/** MIN tick-list sentinel — the insert hint for an empty neighborhood. */
const MIN_SENTINEL = '-400001i32'
/** A fresh fee tier for this suite's pool, distinct from the harness's. */
const FEE = 500
const TICK_SPACING = 10
const EMPTY_PROOFS = formatMerkleProofPair(EMPTY_MERKLE_PROOFS)

/** Pulls the field-literal id out of a generated execute result tuple. */
function firstField(result: unknown): string {
  const flat = (Array.isArray(result) ? result : [result]).filter((v): v is string => typeof v === 'string')
  return requireFieldOutput(flat, 'generated execute')
}

/** Pulls a named literal value out of a struct plaintext. */
function structValue(plaintext: string, name: string): string {
  const m = plaintext.match(new RegExp(`${name}:\\s*([^,\\n}]+)`))
  if (!m) throw new Error(`No ${name} in: ${plaintext}`)
  return m[1]!.trim()
}

/** Joins a slot's Q128.128 `sqrt_price: { hi, lo }` U256 struct to a bigint. */
function slotSqrtPrice(slotPlaintext: string): bigint {
  const m = slotPlaintext.match(/sqrt_price:\s*\{\s*hi:\s*(\d+)u128,\s*lo:\s*(\d+)u128\s*\}/)
  if (!m) throw new Error(`No U256 sqrt_price in: ${slotPlaintext}`)
  return (BigInt(m[1]!) << 128n) + BigInt(m[2]!)
}

describe.runIf(RUN)('e2e: shield_swap lifecycle on devnode (generated contract)', () => {
  let ctx: AmmDevnode
  let adminContract: any
  let userContract: any
  let token0: TokenInfo
  let token1: TokenInfo
  let poolKey: string
  let positionTokenId: string
  let nftRecord: string

  async function refreshNft(txId: string) {
    const records = await ctx.recordsOf(ctx.user.account.viewKey, txId)
    const nft = records.find((r) => r.includes('tick_lower'))
    expect(nft, `PositionNFT record in ${txId}`).toBeDefined()
    if (nftRecord === undefined) {
      expect(nft).toMatch(new RegExp(`tick_lower:\\s*${-10 * TICK_SPACING}i32`))
      expect(nft).toMatch(new RegExp(`tick_upper:\\s*${10 * TICK_SPACING}i32`))
    }
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
    adminContract = createShieldSwapContract({
      publicClient: ctx.admin.publicClient,
      walletClient: ctx.admin.walletClient,
      imports: ctx.imports,
    })
    userContract = createShieldSwapContract({
      publicClient: ctx.user.publicClient,
      walletClient: ctx.user.walletClient,
      imports: ctx.imports,
    })
    // Sort the two plain tokens for canonical pool order.
    const [a, b] = [ctx.tokens.plainA, ctx.tokens.plainB]
    ;[token0, token1] = BigInt(a.field.replace('field', '')) < BigInt(b.field.replace('field', '')) ? [a, b] : [b, a]

    // Register a fresh fee tier + spacing for this suite's own pool.
    await adminContract.execute.add_fee_tier({ arg0: `${FEE}u16` })
    await ctx.testClient.advanceBlock({ count: 1 })
    await adminContract.execute.add_tick_spacing({ arg0: `${TICK_SPACING}u32` })
    await ctx.testClient.advanceBlock({ count: 1 })
    await adminContract.execute.bind_fee_to_tick_spacing({ arg0: `${FEE}u16`, arg1: `${TICK_SPACING}u32` })
    await ctx.testClient.advanceBlock({ count: 1 })
  }, 900_000)

  afterAll(async () => {
    await ctx?.stop()
  }, 60_000)

  it('create_pool registers the pool and its slot with a U256 sqrt price', async () => {
    const { transactionId, result } = await adminContract.execute.create_pool({
      arg0: token0.field,
      arg1: token1.field,
      arg2: `${FEE}u16`,
      // The migrated ABI takes the Q128.128 sqrt price as the { hi, lo } U256 struct.
      arg3: formatU256Literal(getSqrtPriceAtTickX128(0)),
      arg4: `${TICK_SPACING}u32`,
      arg5: '0i32',
    })
    expect(transactionId).toMatch(/^at1/)
    poolKey = firstField(result)

    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'initialized_pools', key: poolKey })).toBe('true')
    const pool = String(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'pools', key: poolKey }))
    expect(structValue(pool, 'enabled')).toBe('true')
    expect(structValue(pool, 'fee')).toBe(`${FEE}u16`)
    const slot = String(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'slots', key: poolKey }))
    expect(structValue(slot, 'tick')).toBe('0i32')
    expect(structValue(slot, 'tick_spacing')).toBe(`${TICK_SPACING}u32`)
    expect(structValue(slot, 'liquidity')).toBe('0u128')
  }, 240_000)

  it('mint opens a position through raw transition arguments and [MerkleProof; 2] proofs', async () => {
    const record0 = await ctx.mintPlainToUser(token0.program, 200_000_000n)
    const record1 = await ctx.mintPlainToUser(token1.program, 200_000_000n)
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
      // Empty tick list: the lower tick's predecessor is the MIN sentinel; the
      // upper tick's predecessor is the lower tick, inserted first this finalize.
      tickLowerHint: -400001,
      tickUpperHint: tickLower,
    })
    const { transactionId, result } = await userContract.execute.mint({
      arg0: generateFieldNonce(),
      arg1: record0,
      arg2: record1,
      arg3: ctx.user.account.address,
      arg4: ctx.user.account.address,
      arg5: request,
      arg6: token0.field,
      arg7: token1.field,
      // signer / recipient / withdrawal freezelist non-inclusion witnesses.
      arg8: EMPTY_PROOFS,
      arg9: EMPTY_PROOFS,
      arg10: EMPTY_PROOFS,
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
    const record0 = await ctx.mintPlainToUser(token0.program, 100_000_000n)
    const record1 = await ctx.mintPlainToUser(token1.program, 100_000_000n)
    const { transactionId } = await userContract.execute.increase_liquidity({
      arg0: nftRecord,
      arg1: record0,
      arg2: record1,
      arg3: '50000000u128',
      arg4: '50000000u128',
      arg5: '0u128',
      arg6: '0u128',
      arg7: token0.field,
      arg8: token1.field,
      arg9: MIN_SENTINEL,
      arg10: MIN_SENTINEL,
    })
    await refreshNft(transactionId)
    expect((await positionNumbers()).liquidity).toBeGreaterThan(before.liquidity)
  }, 240_000)

  it('decrease_liquidity settles the withdrawn amounts as owed', async () => {
    const before = await positionNumbers()
    const remove = before.liquidity / 4n
    const { transactionId } = await userContract.execute.decrease_liquidity({
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

  it('swap and claim_swap_output move tokens with a manually blinded identity (raw U256 limit)', async () => {
    for (const zeroForOne of [true, false]) {
      const tokenIn = zeroForOne ? token0 : token1
      const tokenRecord = await ctx.mintPlainToUser(tokenIn.program, 20_000_000n)
      const slotBefore = String(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'slots', key: poolKey }))

      const identity = await nextBlindedIdentity(ctx.user.walletClient, {
        viewKeyScalar: await viewKeyToScalar(ctx.user.account.viewKey),
        signer: ctx.user.account.address,
        program: AMM_PROGRAM,
      })

      const { result } = await userContract.execute.swap({
        arg0: tokenRecord,
        arg1: identity.blindingFactor,
        arg2: identity.blindedAddress,
        arg3: poolKey,
        arg4: zeroForOne ? 'true' : 'false',
        arg5: '2000000u128',
        arg6: '0u128',
        // The migrated ABI takes sqrt_price_limit as the { hi, lo } U256 struct.
        arg7: formatU256Literal(zeroForOne ? MIN_SQRT_RATIO_X128 : MAX_SQRT_RATIO_X128),
        arg8: `${Date.now()}u64`,
        arg9: await deadline(),
        arg10: token0.field,
        arg11: token1.field,
      })
      const swapId = firstField(result)

      const output = String(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'swap_outputs', key: swapId }))
      const amountOut = structValue(output, 'amount_out')
      const chainAmountOut = BigInt(amountOut.replace('u128', ''))
      expect(chainAmountOut).toBeGreaterThan(0n)

      const claim = await userContract.execute.claim_swap_output({
        arg0: identity.blindingFactor,
        arg1: identity.blindedAddress,
        arg2: swapId,
        arg3: structValue(output, 'token_in'),
        arg4: structValue(output, 'token_out'),
        arg5: amountOut,
        arg6: structValue(output, 'amount_remaining'),
        // Non-inclusion witness pair for the claim.
        arg7: EMPTY_PROOFS,
      })
      expect(claim.transactionId).toMatch(/^at1/)
      const records = await ctx.recordsOf(ctx.user.account.viewKey, claim.transactionId)
      const paid = records.map((r) => parseTokenRecordInfo(r)).find((i) => i?.amount === chainAmountOut)
      expect(paid, `a claimed Token record of ${chainAmountOut}`).toBeDefined()

      const slotAfter = String(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'slots', key: poolKey }))
      // sqrt_price is the Q128.128 { hi, lo } U256 struct in the migrated stack.
      const priceBefore = slotSqrtPrice(slotBefore)
      const priceAfter = slotSqrtPrice(slotAfter)
      if (zeroForOne) expect(priceAfter).toBeLessThan(priceBefore)
      else expect(priceAfter).toBeGreaterThan(priceBefore)
    }
  }, 480_000)

  it('collect drains the owed amounts and pays them out', async () => {
    let paidOut = 0n
    for (let pass = 0; pass < 2; pass++) {
      const owed = await positionNumbers()
      if (owed.owed0 + owed.owed1 === 0n) {
        if (pass === 0) throw new Error('collect precondition: position owes nothing')
        break
      }
      const { transactionId } = await userContract.execute.collect({
        arg0: nftRecord,
        arg1: `${owed.owed0}u128`,
        arg2: `${owed.owed1}u128`,
        arg3: token0.field,
        arg4: token1.field,
        // owner / withdrawal non-inclusion witnesses.
        arg5: EMPTY_PROOFS,
        arg6: EMPTY_PROOFS,
      })
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
      const { transactionId } = await userContract.execute.decrease_liquidity({
        arg0: nftRecord,
        arg1: `${remaining.liquidity}u128`,
        arg2: '0u128',
        arg3: '0u128',
      })
      await refreshNft(transactionId)
    }
    const owed = await positionNumbers()
    if (owed.owed0 + owed.owed1 > 0n) {
      const { transactionId } = await userContract.execute.collect({
        arg0: nftRecord,
        arg1: `${owed.owed0}u128`,
        arg2: `${owed.owed1}u128`,
        arg3: token0.field,
        arg4: token1.field,
        arg5: EMPTY_PROOFS,
        arg6: EMPTY_PROOFS,
      })
      await refreshNft(transactionId)
    }

    const { transactionId } = await userContract.execute.burn({ arg0: nftRecord })
    expect(transactionId).toMatch(/^at1/)
    expect(await ctx.admin.publicClient.readContract({ programId: AMM_PROGRAM, mapping: 'positions', key: positionTokenId })).toBeFalsy()
  }, 240_000)
})
