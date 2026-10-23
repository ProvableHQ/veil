import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { InventoryRecord } from '@provablehq/veil-core'
import { formatUnits, parseUnits } from '../../src/index.js'
import { createInventoryHarness, plaintext, poll, RUN_INVENTORY, WRITE_TIMEOUT, REBALANCE_TIMEOUT,
  type InventoryHarness, type InventoryTestToken } from './recordInventoryHarness.js'

/**
 * Maintains six equal records per token while trading USDCx to ETH and back.
 * Each round claims both legs, restores the target, and verifies record identity,
 * minimum amounts, exact token accounting, and durable reservation outcomes.
 * Testnet writes require VEIL_INVENTORY_E2E=1 and an existing funded account.
 * VEIL_INVENTORY_ROUNDS defaults to 3 (at most 5); VEIL_INVENTORY_SWAP_USDCX defaults to 0.1.
 */
const rounds = Number(process.env.VEIL_INVENTORY_ROUNDS ?? 3)
if (RUN_INVENTORY && (!Number.isInteger(rounds) || rounds < 1 || rounds > 5)) throw new Error('VEIL_INVENTORY_ROUNDS must be from 1 to 5')

describe.runIf(RUN_INVENTORY).sequential('live USDCx/ETH inventory strategy', () => {
  let h: InventoryHarness
  let usdcx: InventoryTestToken
  let eth: InventoryTestToken
  let poolKey: string
  let imports: Record<string, string>
  let tradeAmount: bigint
  let failed = false
  const runTransactionIds: string[] = []
  const consumed = new Set<string>()
  const step = (body: () => Promise<void>) => async () => { failed = true; await body(); failed = false }
  beforeEach(context => { if (failed) context.skip() })
  beforeAll(async () => {
    h = await createInventoryHarness()
    usdcx = h.tokens.find(token => token.symbol === 'USDCx')!
    eth = h.tokens.find(token => token.symbol === 'ETH')!
    tradeAmount = parseUnits(process.env.VEIL_INVENTORY_SWAP_USDCX ?? '0.1', usdcx.decimals)
    if (tradeAmount <= 0n) throw new Error('VEIL_INVENTORY_SWAP_USDCX must be positive')
    // Choose a live direct pool from API metadata, then require on-chain
    // liquidity and trade controls before sending either token through it.
    const pools = (await h.client.api.getPools({ limit: 100 })).data
      .filter(pool => [pool.token0, pool.token1].includes(usdcx.id) && [pool.token0, pool.token1].includes(eth.id))
    let deepest = 0n
    for (const pool of pools) {
      const slot = await h.client.getSlot({ poolKey: pool.key })
      const controls = await h.client.getTradeControls({ poolKey: pool.key })
      if (slot && slot.liquidity > deepest && controls.tradeable) { poolKey = pool.key; deepest = slot.liquidity }
    }
    if (!poolKey) throw new Error('No tradeable USDCx/ETH pool with on-chain liquidity')
    imports = await h.client.resolveDexImports({ tokenPrograms: [usdcx.ammTokenProgram!, eth.ammTokenProgram!] })
    console.log(`strategy: ${h.count} records per token, ${rounds} round trips, ${formatUnits(tradeAmount, usdcx.decimals)} USDCx per round`)
  }, WRITE_TIMEOUT)
  afterAll(async () => { await h?.close() })

  /** Submits one swap and claims it before checking the independently predicted balances. */
  async function swapAndClaim(from: InventoryTestToken, to: InventoryTestToken, amount: bigint, input: InventoryRecord) {
    const beforeIn = await h.scan(from)
    const beforeOut = await h.scan(to)
    expect(input.amount >= amount, `${from.symbol} covering input`).toBe(true)
    expect(consumed.has(input.id), 'a previous swap input cannot be reused').toBe(false)
    const handle = await h.client.swap({ poolKey, tokenInId: from.id, amountIn: amount,
      tokenRecord: plaintext(input), slippageBps: 100, imports })
    consumed.add(input.id)
    runTransactionIds.push(handle.transactionId)
    expect(Boolean(handle.swapId), 'confirmed swap has a claim id').toBe(true)
    const finalized = await poll('finalized swap output', () => h.client.getSwapOutput({ swapId: handle.swapId! }), value => value !== null)
    // Claim before asserting economics so a failing assertion cannot strand an
    // otherwise valid output. The durable identity store retains the handle if a
    // service failure interrupts the claim itself.
    const claim = await h.client.claimSwapOutput({ handle, imports })
    runTransactionIds.push(claim.transactionId)
    const outputs = await h.outputRecords(to, claim.transactionId, 1)
    await poll('consumed swap output', () => h.client.getSwapOutput({ swapId: handle.swapId! }), value => value === null)
    expect(claim.amountOut).toBeGreaterThan(0n)
    expect(claim.amountOut).toBe(finalized!.amount_out)
    expect(claim.amountRemaining, 'small test trades must fill completely').toBe(0n)
    expect(outputs[0]!.amount).toBe(claim.amountOut)
    const afterIn = await h.scan(from)
    const afterOut = await h.scan(to)
    expect(afterIn.balance, `${from.symbol} debit`).toBe(beforeIn.balance - amount)
    expect(afterOut.balance, `${to.symbol} credit`).toBe(beforeOut.balance + claim.amountOut)
    expect(afterIn.available.some(record => record.id === input.id), 'spent nonce remains excluded').toBe(false)
    const spend = (await h.store.list(h.scope)).find(entry => entry.transactionId === handle.transactionId)!
    expect(spend.status).toBe('confirmed')
    expect(spend.records).toContain(input.id)
    expect((await h.identities.load()).find(identity => identity.swapId === handle.swapId)?.status).toBe('claimed')
    return { amountOut: claim.amountOut, output: outputs[0]! }
  }

  it('prepares both inventories with equal amounts above the configured minimum', step(async () => {
    for (const token of h.tokens) await h.rebalance(token)
    const inventory = await h.assertBalanced(usdcx)
    // Keep the source record above its minimum after the forward swap. This
    // makes the count change from each claim the reason maintenance is needed.
    expect(inventory.available.every(record => record.amount - tradeAmount >= usdcx.minimum)).toBe(true)
  }), REBALANCE_TIMEOUT * 2)

  for (let round = 1; round <= (Number.isInteger(rounds) && rounds > 0 && rounds <= 5 ? rounds : 3); round++) {
    it(`round ${round}: swaps USDCx to ETH and back, then restores balanced records`, step(async () => {
      const beforeUSDCx = await h.assertBalanced(usdcx)
      const beforeETH = await h.assertBalanced(eth)
      const forward = await swapAndClaim(usdcx, eth, tradeAmount, beforeUSDCx.available[0]!)
      expect((await h.scan(eth)).available.length).toBe(h.count + 1)
      // Spend the exact newly claimed ETH record on the return leg, preserving
      // the six existing ETH lots and avoiding a second ambiguous selection.
      const backward = await swapAndClaim(eth, usdcx, forward.amountOut, forward.output)
      expect((await h.scan(usdcx)).available.length).toBe(h.count + 1)
      const needsRepair = await h.client.planInventory({ token: usdcx.id, target: usdcx.target, maxTransactions: 24 })
      expect(needsRepair.steps[0]?.kind).toBe('join')
      expect(needsRepair.steps[0]?.inputs.length).toBe(Math.min(h.count + 1, 16))
      expect(needsRepair.steps[0]?.joinProgram?.program).toMatch(/^aj_test_usdcx_stablecoin_/)
      const repaired = await h.rebalance(usdcx)
      expect(repaired.completedSteps).toBe(needsRepair.steps.length)
      const unchangedETH = await h.rebalance(eth)
      expect(unchangedETH.completedSteps).toBe(0)
      expect((await h.assertBalanced(usdcx)).balance).toBe(beforeUSDCx.balance - tradeAmount + backward.amountOut)
      expect((await h.assertBalanced(eth)).balance).toBe(beforeETH.balance)
      console.log(`round ${round} complete: ${formatUnits(tradeAmount, usdcx.decimals)} USDCx → ${formatUnits(forward.amountOut, eth.decimals)} ETH → ${formatUnits(backward.amountOut, usdcx.decimals)} USDCx; ${h.count} balanced records per token`)
    }), REBALANCE_TIMEOUT + WRITE_TIMEOUT * 4)
  }

  it('retains confirmed checkpoints and both balanced inventories after reconnecting', step(async () => {
    await h.restart()
    const journal = await h.client.reconcileRecordInventory()
    for (const id of runTransactionIds) {
      const entry = journal.find(entry => entry.transactionId === id)
      expect(entry?.status, `confirmed checkpoint for ${id}`).toBe('confirmed')
      expect(entry?.transaction).toBeUndefined()
    }
    const confirmedInputs = journal.filter(entry => entry.status === 'confirmed').flatMap(entry => entry.records)
    expect(new Set(confirmedInputs).size, 'no record was consumed by two confirmed transactions').toBe(confirmedInputs.length)
    for (const token of h.tokens) await h.assertBalanced(token)
    expect(runTransactionIds.length).toBe(rounds * 4)
  }), WRITE_TIMEOUT)
})
