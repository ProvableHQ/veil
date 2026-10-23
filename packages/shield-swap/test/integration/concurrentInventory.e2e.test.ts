import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { parseRecord, type InventoryRecord } from '@provablehq/veil-core'
import { formatUnits, parseUnits, type SwapHandle } from '../../src/index.js'
import { createInventoryHarness, poll, RUN_INVENTORY, WRITE_TIMEOUT, REBALANCE_TIMEOUT,
  type InventoryHarness, type InventoryTestToken } from './recordInventoryHarness.js'

/**
 * Runs six concurrent USDCx swaps and six concurrent ETH return swaps with
 * automatic record selection, real delegated proving, and a durable SQLite store.
 * Every successful swap is claimed before batch failures are reported. Requires
 * VEIL_INVENTORY_E2E=1 and the same existing testnet account as the inventory suites.
 */
describe.runIf(RUN_INVENTORY).sequential('live concurrent record inventory swaps', () => {
  let h: InventoryHarness
  let usdcx: InventoryTestToken
  let eth: InventoryTestToken
  let poolKey: string
  let imports: Record<string, string>
  let tradeAmount: bigint
  let failed = false
  const transactionIds: string[] = []
  const consumed = new Set<string>()
  const step = (body: () => Promise<void>) => async () => { failed = true; await body(); failed = false }
  beforeEach(context => { if (failed) context.skip() })
  beforeAll(async () => {
    h = await createInventoryHarness()
    usdcx = h.tokens.find(token => token.symbol === 'USDCx')!
    eth = h.tokens.find(token => token.symbol === 'ETH')!
    tradeAmount = parseUnits(process.env.VEIL_INVENTORY_SWAP_USDCX ?? '0.1', usdcx.decimals)
    if (tradeAmount <= 0n) throw new Error('VEIL_INVENTORY_SWAP_USDCX must be positive')
    // API metadata identifies the pair; live chain state decides which pool is
    // liquid and tradeable before any maintenance or swap is submitted.
    const pools = (await h.client.api.getPools({ limit: 100 })).data.filter(pool =>
      [pool.token0, pool.token1].includes(usdcx.id) && [pool.token0, pool.token1].includes(eth.id))
    let deepest = 0n
    for (const pool of pools) {
      const slot = await h.client.getSlot({ poolKey: pool.key })
      const controls = await h.client.getTradeControls({ poolKey: pool.key })
      if (slot && slot.liquidity > deepest && controls.tradeable) { poolKey = pool.key; deepest = slot.liquidity }
    }
    if (!poolKey) throw new Error('No tradeable USDCx/ETH pool with on-chain liquidity')
    imports = await h.client.resolveDexImports({ tokenPrograms: [usdcx.ammTokenProgram!, eth.ammTokenProgram!] })
    console.log(`concurrency: ${h.count} simultaneous swaps per batch; ${formatUnits(tradeAmount, usdcx.decimals)} USDCx per forward swap`)
  }, WRITE_TIMEOUT)
  afterAll(async () => { await h?.close() })

  /** Forces first acquisitions to overlap while leaving SQLite acquisition and proving unchanged. */
  async function batch(from: InventoryTestToken, to: InventoryTestToken, amounts: bigint[]) {
    const beforeIn = await h.scan(from)
    const beforeOut = await h.scan(to)
    const acquire = h.store.acquire
    const prover = h.client.proving!
    const execute = prover.execute!
    const attempts: string[][] = []
    const proved: string[] = []
    let active = 0
    let peak = 0
    let release!: () => void
    let timer: ReturnType<typeof setTimeout> | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    h.store.acquire = async entry => {
      attempts.push([...entry.records])
      if (attempts.length <= amounts.length) {
        // A failed preparation must not strand other callers behind the test
        // barrier. The assertions below still require every first attempt.
        timer ??= setTimeout(release, 60_000)
        if (attempts.length === amounts.length) { clearTimeout(timer); release() }
        await gate
      }
      return acquire(entry)
    }
    prover.execute = async options => {
      // Record only nonces, never plaintext or key material, while measuring
      // actual overlapping executions after their reservations have succeeded.
      const input = options.inputs.find(value => value.includes('_nonce'))
      if (!input) throw new Error('Swap reached proving without a record input')
      proved.push(parseRecord(input).nonce)
      peak = Math.max(peak, ++active)
      try { return await execute(options) }
      finally { active-- }
    }
    let results: PromiseSettledResult<SwapHandle>[]
    try {
      results = await Promise.allSettled(amounts.map(async amountIn => {
        // Omit tokenRecord: selection and reselection must run through the SDK.
        const handle = await h.client.swap({ poolKey, tokenInId: from.id, amountIn, slippageBps: 100, imports })
        transactionIds.push(handle.transactionId)
        console.log(`${from.symbol} → ${to.symbol} swap confirmed: ${handle.transactionId}`)
        return handle
      }))
    } finally {
      if (timer) clearTimeout(timer)
      release()
      h.store.acquire = acquire
      prover.execute = execute
    }
    const handles = results.filter((result): result is PromiseFulfilledResult<SwapHandle> => result.status === 'fulfilled').map(result => result.value)
    // Settle every claim before assertions, even if another swap or claim failed.
    // Durable identity handles remain available for explicit recovery on failure.
    const claims = await Promise.allSettled(handles.map(async handle => {
      const finalized = await poll('concurrent swap output', () => h.client.getSwapOutput({ swapId: handle.swapId! }), output => output !== null)
      const claim = await h.client.claimSwapOutput({ handle, imports })
      transactionIds.push(claim.transactionId)
      const outputs = await h.outputRecords(to, claim.transactionId, 1)
      await poll('claimed concurrent swap output', () => h.client.getSwapOutput({ swapId: handle.swapId! }), output => output === null)
      expect(claim.amountOut).toBe(finalized!.amount_out)
      expect(claim.amountOut).toBeGreaterThan(0n)
      expect(claim.amountRemaining).toBe(0n)
      expect(outputs[0]!.amount).toBe(claim.amountOut)
      console.log(`${from.symbol} → ${to.symbol} claimed ${formatUnits(claim.amountOut, to.decimals)} ${to.symbol}: ${claim.transactionId}`)
      return { handle, claim, record: outputs[0]! }
    }))
    const failures = [...results, ...claims].flatMap((result, index) => result.status === 'rejected'
      ? [`operation ${index + 1}: ${result.reason instanceof Error ? result.reason.message : 'unknown failure'}`] : [])
    expect(failures, 'all submitted swaps and successful outputs must settle').toEqual([])
    const settled = claims.map(result => (result as PromiseFulfilledResult<{ handle: SwapHandle; claim: { amountOut: bigint }; record: InventoryRecord }>).value)
    expect(handles).toHaveLength(amounts.length)
    expect(new Set(handles.map(handle => handle.transactionId)).size).toBe(amounts.length)
    expect(new Set(handles.map(handle => handle.blindedAddress)).size).toBe(amounts.length)
    expect(peak, 'proving/confirmation executions actually overlap').toBeGreaterThan(1)
    expect(proved).toHaveLength(amounts.length)
    expect(new Set(proved).size, 'every prover consumes a distinct input').toBe(amounts.length)
    expect(attempts.slice(0, amounts.length)).toHaveLength(amounts.length)
    if (from.symbol === 'USDCx') {
      expect(new Set(attempts.slice(0, amounts.length).map(ids => ids[0])).size, 'all first selections collide').toBe(1)
      expect(attempts.length, 'the losing selections actually retry').toBeGreaterThan(amounts.length)
    }
    for (const id of proved) {
      expect(consumed.has(id), 'inputs from earlier batches are not reused').toBe(false)
      consumed.add(id)
    }
    const afterIn = await h.scan(from)
    const afterOut = await h.scan(to)
    expect(afterIn.balance).toBe(beforeIn.balance - amounts.reduce((sum, amount) => sum + amount, 0n))
    expect(afterOut.balance).toBe(beforeOut.balance + settled.reduce((sum, result) => sum + result.claim.amountOut, 0n))
    expect(afterIn.available.some(record => proved.includes(record.id)), 'spent inputs stay excluded').toBe(false)
    const journal = await h.store.list(h.scope)
    for (const handle of handles) {
      const entry = journal.find(entry => entry.transactionId === handle.transactionId)
      expect(entry?.status).toBe('confirmed')
      expect(entry?.records).toHaveLength(1)
      expect(proved).toContain(entry!.records[0])
      expect((await h.identities.load()).find(identity => identity.swapId === handle.swapId)?.status).toBe('claimed')
    }
    console.log(`${from.symbol} batch verified: ${handles.length} swaps, ${claims.length} claims, ${peak} overlapping executions, ${attempts.length - handles.length} reservation conflicts`)
    return { settled, proved }
  }

  it('prepares balanced records above the minimum for both tokens', step(async () => {
    for (const token of h.tokens) await h.rebalance(token)
    const inventory = await h.assertBalanced(usdcx)
    expect(inventory.available.every(record => record.amount - tradeAmount >= usdcx.minimum)).toBe(true)
  }), REBALANCE_TIMEOUT * 2)

  it('swaps concurrently in both directions and restores the balanced inventories', step(async () => {
    const beforeUSDCx = await h.assertBalanced(usdcx)
    const beforeETH = await h.assertBalanced(eth)
    const forward = await batch(usdcx, eth, Array<bigint>(h.count).fill(tradeAmount))
    // Return the amounts received, letting automatic selection match each one
    // to a covering record instead of passing those record plaintexts explicitly.
    const backward = await batch(eth, usdcx, forward.settled.map(result => result.claim.amountOut))
    expect(new Set(backward.proved)).toEqual(new Set(forward.settled.map(result => result.record.id)))
    for (const token of h.tokens) await h.rebalance(token)
    expect((await h.assertBalanced(usdcx)).balance).toBe(beforeUSDCx.balance - tradeAmount * BigInt(h.count) +
      backward.settled.reduce((sum, result) => sum + result.claim.amountOut, 0n))
    expect((await h.assertBalanced(eth)).balance).toBe(beforeETH.balance)
  }), REBALANCE_TIMEOUT * 2 + WRITE_TIMEOUT * 4)

  it('retains every confirmed spend without duplicate inputs after reconnecting', step(async () => {
    await h.restart()
    const journal = await h.client.reconcileRecordInventory()
    expect(transactionIds).toHaveLength(h.count * 4)
    for (const id of transactionIds) {
      const entry = journal.find(entry => entry.transactionId === id)
      expect(entry?.status, `confirmed checkpoint ${id}`).toBe('confirmed')
      expect(entry?.transaction).toBeUndefined()
    }
    const used = journal.filter(entry => entry.status === 'confirmed').flatMap(entry => entry.records)
    expect(new Set(used).size).toBe(used.length)
    for (const token of h.tokens) await h.assertBalanced(token)
  }), WRITE_TIMEOUT)
})
