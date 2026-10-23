import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { recordActions } from '@provablehq/veil-core'
import { createInventoryHarness, plaintext, RUN_INVENTORY, WRITE_TIMEOUT, REBALANCE_TIMEOUT, type InventoryHarness } from './recordInventoryHarness.js'

/**
 * Exercises inventory methods through the real testnet scanner, prover, and chain.
 * Explicitly spends funded testnet records; the normal suite skips this file.
 * Run with VEIL_INVENTORY_E2E=1 VEIL_E2E_STATE_FILE=<testnet state.json> pnpm vitest run <this file> --bail=1.
 * Retain .veil/inventory-e2e/ after failures: it holds prepared transactions and reservations.
 */
describe.runIf(RUN_INVENTORY).sequential('live record inventory lifecycle', () => {
  let h: InventoryHarness
  let failed = false
  // A failed prerequisite stops later writes, even when the CLI omits --bail=1.
  const step = (body: () => Promise<void>) => async () => { failed = true; await body(); failed = false }
  beforeEach(context => { if (failed) context.skip() })
  beforeAll(async () => { h = await createInventoryHarness() }, WRITE_TIMEOUT)
  afterAll(async () => { await h?.close() })

  it('reads defaults and overrides, rejects impossible targets, and keeps unmanaged execution disabled', step(async () => {
    const before = (await h.store.list(h.scope)).length
    for (const token of h.tokens) {
      const inventory = await h.scan(token)
      expect(inventory.asset.recordName).toBe('Token')
      expect(inventory.asset.amountField).toBe('amount')
      expect(inventory.asset.amountType).toBe('u128')
      const explicit = await h.client.getRecordInventory({ asset: { ...token.asset, recordName: 'Token', amountField: 'amount' } })
      expect(explicit.balance).toBe(inventory.balance)
      expect(explicit.available.map(record => record.id)).toEqual(inventory.available.map(record => record.id))
      const plan = await h.client.planInventory({ token: token.id, target: token.target, maxTransactions: 24 })
      expect(plan.asset.program).toBe(token.asset.program)
      expect(plan.deduction).toBe(0n)
      const unmanaged = h.unmanaged().extend(recordActions())
      expect(unmanaged.recordManagement).toBeUndefined()
      await expect(unmanaged.rebalanceRecordInventory({ plan })).rejects.toThrow('recordManagement.enabled')
      await expect(h.client.planRecordInventory({ asset: token.asset,
        target: { records: h.count, minRecordAmount: inventory.balance + 1n } })).rejects.toThrow()
    }
    expect((await h.store.list(h.scope)).length, 'read/validation paths do not reserve or submit').toBe(before)
  }), WRITE_TIMEOUT)

  it('excludes a shared reservation and rejects competing writes before proving', step(async () => {
    const token = h.tokens[0]!
    let inventory = await h.scan(token)
    // A prior interrupted run may have consolidated this token already. Restore
    // enough inputs for both the reservation check and the later helper chain.
    if (inventory.available.length < 5) {
      const prepared = await h.client.rebalanceInventory({ token: token.id, target: { records: 5, distribution: 'balanced' },
        maxTransactions: 6, timeoutMs: WRITE_TIMEOUT })
      expect(prepared.status, prepared.reason).toBe('complete')
      inventory = await h.scan(token)
    }
    expect(inventory.available.length).toBeGreaterThanOrEqual(2)
    const [record, other] = inventory.available
    const held = await h.store.acquire({ scope: h.scope, records: [record!.id], program: token.asset.program,
      function: 'join', status: 'reserved', createdAt: Date.now(), accountType: 'local' })
    expect(Boolean(held)).toBe(true)
    try {
      const peer = h.peer()
      const visible = await peer.getRecordInventory({ asset: token.asset })
      expect(visible.available.some(item => item.id === record!.id)).toBe(false)
      expect(visible.reserved.map(item => item.id)).toContain(record!.id)
      expect(visible.balance).toBe(inventory.balance - record!.amount)
      await expect(peer.joinRecords({ asset: token.asset, records: [record!, other!] })).rejects.toThrow('already reserved')
      const call = { program: token.asset.program, function: 'split', inputs: [plaintext(record!), '1u128'] }
      await expect(peer.writeContract(call)).rejects.toThrow('already reserved')
      await expect(peer.executeContract(call)).rejects.toThrow('already reserved')
      expect((await h.store.list(h.scope)).find(entry => entry.id === held!.id)?.transactionId).toBeUndefined()
    } finally {
      // This entry never reaches proving or broadcast; release only this synthetic reservation.
      await h.store.update(h.scope, held!.id, { status: 'cancelled' })
    }
    expect((await h.scan(token)).balance).toBe(inventory.balance)
  }), REBALANCE_TIMEOUT)

  it.each(['USDCx', 'ETH'])('joins three %s records with a helper and consolidates the remaining inventory', symbol => step(async () => {
    const token = h.tokens.find(token => token.symbol === symbol)!
    let before = await h.scan(token)
    // Leave at least three inputs after the first join so autoJoin must also
    // resolve a helper output, including when rerunning a consolidated account.
    if (before.available.length < 5) {
      const prepared = await h.client.rebalanceInventory({ token: token.id, target: { records: 5, distribution: 'balanced' },
        maxTransactions: 6, timeoutMs: WRITE_TIMEOUT })
      expect(prepared.status, prepared.reason).toBe('complete')
      before = await h.scan(token)
    }
    const inputs = before.available.slice(0, 3)
    const transactionId = await h.client.joinRecords({ asset: token.asset, records: inputs })
    const outputs = await h.outputRecords(token, transactionId, 1)
    expect(outputs[0]!.amount).toBe(inputs.reduce((sum, record) => sum + record.amount, 0n))
    const joined = await h.scan(token)
    expect(joined.available.length).toBe(before.available.length - 2)
    expect(joined.balance).toBe(before.balance)
    const journal = (await h.store.list(h.scope)).find(entry => entry.transactionId === transactionId)!
    expect(journal.program).toBe(symbol === 'USDCx' ? 'aj_test_usdcx_stablecoin_2_10.aleo' : 'test_aj_arc20_2_15.aleo')
    expect(journal.function).toBe('join_3')
    expect(journal.assetProgram).toBe(token.asset.program)
    expect(journal.status).toBe('confirmed')
    expect(journal.records.slice().sort()).toEqual(inputs.map(record => record.id).sort())
    const consolidated = await h.client.autoJoin({ asset: token.asset, maxTransactions: 16,
      timeoutMs: WRITE_TIMEOUT, pollIntervalMs: 3000 })
    expect(consolidated.status, consolidated.reason).toBe('complete')
    const after = await h.scan(token)
    expect(after.available.length).toBe(1)
    expect(after.balance).toBe(before.balance)
    const unchanged = (await h.store.list(h.scope)).length
    const sufficient = await h.client.autoJoin({ asset: token.asset, minAmount: token.minimum })
    expect(sufficient.transactionIds).toEqual([])
    expect((await h.store.list(h.scope)).length).toBe(unchanged)
  })(), REBALANCE_TIMEOUT)

  it.each(['USDCx', 'ETH'])('executes a reviewed %s plan and preserves a satisfied Shield Swap target', symbol => step(async () => {
    const token = h.tokens.find(token => token.symbol === symbol)!
    const before = await h.scan(token)
    const core = await h.client.planRecordInventory({ asset: token.asset, target: token.target, maxTransactions: 24 })
    const dex = await h.client.planInventory({ token: token.id, target: token.target, maxTransactions: 24 })
    expect(dex).toEqual(core)
    expect(core.steps.length).toBe(h.count - 1)
    const result = await h.client.rebalanceRecordInventory({ plan: core, timeoutMs: WRITE_TIMEOUT, pollIntervalMs: 3000 })
    expect(result.status, result.reason).toBe('complete')
    expect(result.completedSteps).toBe(h.count - 1)
    expect((await h.assertBalanced(token)).balance).toBe(before.balance)
    const satisfied = await h.rebalance(token)
    expect(satisfied.completedSteps).toBe(0)
  })(), REBALANCE_TIMEOUT)

  it('recovers a prepared split after reopening the store, then rejoins its exact outputs', step(async () => {
    const token = h.tokens[0]!
    const before = await h.scan(token)
    const input = before.available[0]!
    let preparedId: string | undefined
    const interrupted = new Error('test interruption after durable preparation')
    await expect(h.client.splitRecord({ asset: token.asset, record: input, amount: token.minimum,
      onProgress: event => {
        if (event.type === 'transaction-prepared') { preparedId = event.transactionId; throw interrupted }
      } })).rejects.toThrow(interrupted.message)
    expect(typeof preparedId).toBe('string')
    await h.restart()
    const saved = (await h.store.list(h.scope)).find(entry => entry.transactionId === preparedId)!
    expect(saved.status).toBe('prepared')
    expect(saved.transaction?.id).toBe(preparedId)
    expect((await h.scan(token)).reserved.some(record => record.id === input.id)).toBe(true)
    // Reconciliation submits the already proved transaction with its original id.
    // It must not construct a replacement that could race the first spend.
    await h.client.reconcileRecordInventory({ rebroadcast: true })
    const outputs = await h.outputRecords(token, preparedId!, 2)
    expect(outputs.map(record => record.amount).sort((a, b) => a < b ? -1 : 1))
      .toEqual([token.minimum, input.amount - token.minimum].sort((a, b) => a < b ? -1 : 1))
    const restored = await h.client.joinRecords({ asset: token.asset, records: outputs })
    expect((await h.outputRecords(token, restored, 1))[0]!.amount).toBe(input.amount)
    expect((await h.assertBalanced(token)).balance).toBe(before.balance)
    const reconciled = await h.client.reconcileRecordInventory()
    const recovered = reconciled.find(entry => entry.transactionId === preparedId)!
    expect(recovered.status).toBe('confirmed')
    expect(recovered.transaction).toBeUndefined()
    expect(reconciled.filter(entry => entry.transactionId === preparedId).length).toBe(1)
  }), WRITE_TIMEOUT * 3)
})
