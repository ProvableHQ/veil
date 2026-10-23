import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createInventoryHarness, plaintext, RUN_INVENTORY, WRITE_TIMEOUT, REBALANCE_TIMEOUT,
  type InventoryHarness, type InventoryTestToken } from './recordInventoryHarness.js'

/**
 * Checks execution guards and native join fallback against the real testnet.
 * Uses the hosted scanner, delegated prover, ledger, and durable SQLite journal.
 * Run with VEIL_INVENTORY_E2E=1 VEIL_E2E_STATE_FILE=<testnet state.json> pnpm vitest run <this file> --bail=1.
 * Retain .veil/inventory-e2e/ after interruption; never repeat an uncertain submission.
 */
describe.runIf(RUN_INVENTORY).sequential('live inventory execution guards', () => {
  let h: InventoryHarness
  let failed = false
  const submitted: string[] = []
  const step = (body: () => Promise<void>) => async () => { failed = true; await body(); failed = false }
  beforeEach(context => { if (failed) context.skip() })
  beforeAll(async () => { h = await createInventoryHarness() }, WRITE_TIMEOUT)
  afterAll(async () => { await h?.close() })

  // Check the actual accepted transition and scanner outputs before using either
  // child record. A separate deposit cannot satisfy these commitments.
  async function split(token: InventoryTestToken, record: Parameters<typeof plaintext>[0], amount: bigint) {
    const id = await h.client.splitRecord({ asset: token.asset, record, amount })
    submitted.push(id)
    const outputs = await h.outputRecords(token, id, 2)
    expect(outputs.map(output => output.amount).sort((a, b) => a < b ? -1 : 1))
      .toEqual([amount, record.amount - amount].sort((a, b) => a < b ? -1 : 1))
    console.log(`${token.symbol} native split confirmed: ${id}`)
    return outputs
  }

  it('prepares balanced inventory for both tokens before testing write guards', step(async () => {
    for (const token of h.tokens) await h.rebalance(token)
  }), REBALANCE_TIMEOUT * 2)

  it('rejects modified plans, cancellation, and newly reserved inputs before submission', step(async () => {
    const token = h.tokens[0]!
    const before = await h.scan(token)
    const plan = await h.client.planRecordInventory({ asset: token.asset, target: { records: 1 } })
    const count = (await h.store.list(h.scope)).length
    expect(plan.steps.length).toBeGreaterThan(0)
    const modified = structuredClone(plan)
    modified.steps[0]!.outputs[0]!.amount++
    await expect(h.client.rebalanceRecordInventory({ plan: modified })).rejects.toThrow('modified')
    const cancelled = await h.client.rebalanceRecordInventory({ plan, signal: AbortSignal.abort(new Error('Cancelled by caller')) })
    expect(cancelled).toMatchObject({ status: 'interrupted', completedSteps: 0, transactionIds: [], reason: 'Cancelled by caller' })
    expect(await h.store.list(h.scope)).toHaveLength(count)
    const held = await h.store.acquire({ scope: h.scope, records: [plan.steps[0]!.inputs[0]!],
      program: token.asset.program, function: 'join', status: 'reserved', createdAt: Date.now(), accountType: 'local' })
    expect(held).toBeDefined()
    try {
      const stale = await h.client.rebalanceRecordInventory({ plan })
      expect(stale).toMatchObject({ status: 'interrupted', completedSteps: 0, transactionIds: [] })
      expect(stale.reason).toContain('Inventory changed')
      expect(await h.store.list(h.scope)).toHaveLength(count + 1)
    } finally {
      // This reservation never reaches proving. Release only this test's entry.
      await h.store.update(h.scope, held!.id, { status: 'cancelled' })
    }
    expect((await h.scan(token)).balance).toBe(before.balance)
  }), WRITE_TIMEOUT)

  it.each(['writeContract', 'executeContract'] as const)('%s rejects an excessive proved fee before broadcast', action => step(async () => {
    const token = h.tokens[0]!
    const before = await h.scan(token)
    const input = before.available[0]!
    const count = (await h.store.list(h.scope)).length
    const limited = h.peer({ maxFeeMicrocredits: 0n })
    // The real prover builds the split, but the zero ceiling must prevent its
    // broadcast even when FeeMaster would have paid the network fee.
    await expect(limited[action]({ program: token.asset.program, function: 'split', inputs: [plaintext(input), '1u128'] }))
      .rejects.toThrow('Proved transaction exceeds maxFeeMicrocredits')
    const entries = (await h.store.list(h.scope)).slice(count)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ status: 'cancelled', records: [input.id] })
    expect(entries[0]!.transactionId).toBeUndefined()
    const after = await h.scan(token)
    expect(after.available.some(record => record.id === input.id)).toBe(true)
    expect(after.balance).toBe(before.balance)
  })(), WRITE_TIMEOUT)

  it.each(['USDCx', 'ETH'])('uses two native %s joins when helpers are disabled and restores the original lots', symbol => step(async () => {
    const token = h.tokens.find(token => token.symbol === symbol)!
    const before = await h.assertBalanced(token)
    const sorted = before.available.map(record => record.amount).sort((a, b) => a > b ? -1 : 1)
    const threshold = sorted[0]! + sorted[1]! + sorted[2]!
    const native = h.peer({ tokenJoin: false })
    const result = await native.autoJoin({ asset: token.asset, minAmount: threshold,
      maxTransactions: 2, timeoutMs: WRITE_TIMEOUT, pollIntervalMs: 3_000 })
    submitted.push(...result.transactionIds)
    expect(result.status, result.reason).toBe('complete')
    expect(result.completedSteps).toBe(2)
    expect(result.transactionIds).toHaveLength(2)
    const journal = await h.store.list(h.scope)
    const consumed = new Set<string>()
    for (const id of result.transactionIds) {
      const entry = journal.find(entry => entry.transactionId === id)!
      expect(entry).toMatchObject({ program: token.asset.program, function: 'join', status: 'confirmed' })
      expect(entry.records).toHaveLength(2)
      for (const nonce of entry.records) consumed.add(nonce)
      const tx = await h.confirm(id)
      expect(tx.execution!.transitions.map(transition => `${transition.program}/${transition.function}`))
        .toEqual([`${token.asset.program}/join`])
      console.log(`${symbol} native join confirmed: ${id}`)
    }
    const originals = before.available.filter(record => consumed.has(record.id))
    expect(originals).toHaveLength(3)
    const joined = await h.scan(token)
    expect(joined.balance).toBe(before.balance)
    expect(joined.available).toHaveLength(h.count - 2)
    const unchanged = before.available.filter(record => !consumed.has(record.id)).map(record => record.id).sort()
    expect(joined.available.filter(record => before.available.some(previous => previous.id === record.id)).map(record => record.id).sort())
      .toEqual(unchanged)
    const combined = joined.available.find(record => record.amount === threshold)!
    expect(combined).toBeDefined()
    // Restore the three consumed lots with two native splits. Their total token
    // value is unchanged, and the untouched records retain their original nonces.
    const first = await split(token, combined, originals[0]!.amount)
    const remainder = first.find(record => record.amount === threshold - originals[0]!.amount)!
    await split(token, remainder, originals[1]!.amount)
    const restored = await h.assertBalanced(token)
    expect(restored.balance).toBe(before.balance)
    expect(restored.available.map(record => record.amount).sort()).toEqual(before.available.map(record => record.amount).sort())
  })(), WRITE_TIMEOUT * 5)

  it('stops a dependent join sequence after submission and retains the first spend until confirmation', step(async () => {
    const token = h.tokens[0]!
    const before = await h.assertBalanced(token)
    const native = h.peer({ tokenJoin: false })
    const amounts = before.available.map(record => record.amount).sort((a, b) => a > b ? -1 : 1)
    const controller = new AbortController()
    const update = h.store.update
    // Cancel at the persisted submission boundary while leaving proving, sending,
    // confirmation, and every journal write on their real implementations.
    h.store.update = async (scope, id, patch) => {
      await update(scope, id, patch)
      if (patch.status === 'submitted') controller.abort(new Error('Cancel after submission'))
    }
    let result: Awaited<ReturnType<typeof native.autoJoin>>
    try {
      result = await native.autoJoin({ asset: token.asset, minAmount: amounts[0]! + amounts[1]! + amounts[2]!,
        maxTransactions: 2, timeoutMs: WRITE_TIMEOUT, pollIntervalMs: 3_000, signal: controller.signal })
    } finally { h.store.update = update }
    submitted.push(...result.transactionIds)
    expect(result.status).toBe('interrupted')
    expect(result.reason).toBe('Cancel after submission')
    expect(result.transactionIds).toHaveLength(1)
    const id = result.transactionIds[0]!
    const entry = (await h.store.list(h.scope)).find(entry => entry.transactionId === id)!
    expect(entry.status).toBe('submitted')
    expect(entry.transaction?.id).toBe(id)
    expect(entry.records).toHaveLength(2)
    const originals = before.available.filter(record => entry.records.includes(record.id))
    expect(originals).toHaveLength(2)
    // Cancellation stops the next step; it does not undo a submitted join.
    const [output] = await h.outputRecords(token, id, 1)
    expect(output!.amount).toBe(originals[0]!.amount + originals[1]!.amount)
    await split(token, output!, originals[0]!.amount)
    expect((await h.assertBalanced(token)).balance).toBe(before.balance)
    console.log(`Cancellation preserved the submitted join and stopped the second: ${id}`)
  }), WRITE_TIMEOUT * 3)

  it('preserves confirmed spends and restored balances after reopening the durable store', step(async () => {
    await h.restart()
    const journal = await h.client.reconcileRecordInventory()
    expect(submitted).toHaveLength(10)
    expect(new Set(submitted).size).toBe(10)
    for (const id of submitted) {
      expect(journal.find(entry => entry.transactionId === id)).toMatchObject({ status: 'confirmed' })
      expect(journal.find(entry => entry.transactionId === id)!.transaction).toBeUndefined()
    }
    expect(journal.filter(entry => !['confirmed', 'rejected', 'cancelled'].includes(entry.status))).toEqual([])
    for (const token of h.tokens) await h.assertBalanced(token)
  }), WRITE_TIMEOUT)
})
