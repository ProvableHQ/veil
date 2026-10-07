import type { Client } from '../../clients/createClient.js'
import type { InventoryPlan, InventoryRecord, InventoryResult } from '../../inventory/types.js'
import { management, positiveInteger, scopeOf } from '../../inventory/internal.js'
import { buildInventoryPlan } from '../../inventory/planner.js'
import { getConfirmedTransaction } from '../public/getConfirmedTransaction.js'
import { requestRecords } from '../wallet/requestRecords.js'
import { getRecordInventory } from './getRecordInventory.js'
import { joinRecords } from './joinRecords.js'
import { splitRecord } from './splitRecord.js'
import { decodeRecord } from './internal.js'
import type { ProvingProgressHandler } from '../../types/proving.js'
import type { Transaction } from '../../types/transaction.js'
import type { ConfirmedTransaction } from '../../types/block.js'
import { inventoryOutputCommitments } from '../../inventory/tokenJoin.js'

/**
 * Configures bounded execution of a previously inspected plan.
 * @property plan Plan from planRecordInventory, tied to its account and chain.
 * @property timeoutMs Confirmation/output visibility timeout per step. Defaults to 120000.
 * @property pollIntervalMs Poll interval, defaults to 1000 milliseconds.
 * @property signal Optional cancellation signal; cancellation preserves submitted reservations.
 * @property maxFeeMicrocredits Optional total network-fee budget for this run, excluding intrinsic split deductions.
 */
export type RebalanceRecordInventoryParameters = {
  plan: InventoryPlan; timeoutMs?: number; pollIntervalMs?: number; signal?: AbortSignal; maxFeeMicrocredits?: bigint
}

/**
 * Executes a plan one confirmed transition at a time through existing write actions.
 * Revalidates each input and matches scanner outputs to confirmed commitments.
 * @param client Client extended with recordActions for reservation and durable progress.
 * @param params Reviewed plan, timeouts, cancellation and optional fee budget.
 * @returns Completion or interruption with all submitted transaction ids; never rolls back accepted steps.
 * @throws On invalid/tampered plans or missing coordination, before submission.
 * @example
 * const result = await rebalanceRecordInventory(client, { plan, maxFeeMicrocredits: 1_000_000n })
 */
export async function rebalanceRecordInventory(client: Client, params: RebalanceRecordInventoryParameters): Promise<InventoryResult> {
  const config = management(client)
  if (!config) throw new Error('Inventory execution requires recordActions')
  // Rebuild instead of trusting caller-supplied transition amounts or dependencies.
  const plan = buildInventoryPlan(params.plan)
  const encode = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item)
  if (encode(plan) !== encode(params.plan)) throw new Error('Inventory plan was modified; plan again')
  if (plan.scope !== scopeOf(client)) throw new Error('Inventory plan belongs to another account or chain')
  const timeout = params.timeoutMs ?? 120_000
  const interval = params.pollIntervalMs ?? 1000
  positiveInteger(timeout, 'timeoutMs', 2_147_483_647)
  positiveInteger(interval, 'pollIntervalMs', 2_147_483_647)
  if (params.maxFeeMicrocredits !== undefined && params.maxFeeMicrocredits < 0n) throw new Error('Fee budget cannot be negative')
  const result: InventoryResult = { status: 'complete', transactionIds: [], completedSteps: 0 }
  const references = new Map(plan.inputs.map((input) => [input.id, input.id]))
  let fees = 0n
  const check = () => {
    params.signal?.throwIfAborted()
    if (scopeOf(client) !== plan.scope) throw new Error('Account or chain changed during inventory execution')
  }
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, interval))
  try {
    for (const step of plan.steps) {
      check()
      const inventory = await getRecordInventory(client, { asset: plan.asset })
      const inputs = step.inputs.map((id) => {
        const record = inventory.available.find((item) => item.id === references.get(id))
        const expected = plan.inputs.find((item) => item.id === id) ?? plan.steps.flatMap((item) => item.outputs).find((item) => item.id === id)
        if (!record || record.amount !== expected?.amount) throw new Error('Inventory changed; reconcile and plan again')
        return record
      })
      check()
      const remaining = params.maxFeeMicrocredits === undefined ? undefined : params.maxFeeMicrocredits - fees
      const perTransaction = config.maxFeeMicrocredits
      const limit = remaining === undefined ? perTransaction : perTransaction === undefined || remaining < perTransaction ? remaining : perTransaction
      const executionClient = Object.assign(Object.create(client), { recordManagement: { ...config, tokenJoin: plan.tokenJoin, maxFeeMicrocredits: limit } }) as Client
      const onProgress: ProvingProgressHandler = (event) => {
        if ('transactionId' in event && !result.transactionIds.includes(event.transactionId)) result.transactionIds.push(event.transactionId)
      }
      const transactionId = step.kind === 'join'
        ? await joinRecords(executionClient, { asset: plan.asset, records: inputs, onProgress })
        : await splitRecord(executionClient, { asset: plan.asset, record: inputs[0]!, amount: step.amount!, onProgress })
      if (!result.transactionIds.includes(transactionId)) result.transactionIds.push(transactionId)
      const journal = await config.store.list(plan.scope)
      const entry = journal.find((item) => item.transactionId === transactionId)
      if (!entry) throw new Error('Submitted transaction is missing its reservation')
      fees += BigInt(entry.feeMicrocredits ?? '0')
      const deadline = Date.now() + timeout
      let confirmed: ConfirmedTransaction | undefined
      while (!confirmed) {
        check()
        if (Date.now() >= deadline) throw new Error(`Timed out confirming ${transactionId}; reservation retained`)
        try { confirmed = await getConfirmedTransaction(client, { id: transactionId }) }
        catch (error) { if ((error as { status?: number }).status !== 404) throw error }
        if (!confirmed) await pause()
      }
      if (confirmed.status !== 'accepted') {
        if (confirmed.status === 'rejected') await config.store.update(plan.scope, entry.id, { status: 'rejected', transaction: undefined })
        throw new Error(`Transaction ${transactionId} was not accepted`)
      }
      await config.store.update(plan.scope, entry.id, { status: 'confirmed', transaction: undefined })
      const commitments = inventoryOutputCommitments(confirmed.transaction as Transaction, plan.asset, step, plan.tokenJoin)
      if (commitments.length !== step.outputs.length) throw new Error('Unexpected confirmed inventory output count')
      // The scanner must return these exact outputs, not an unrelated new deposit.
      let outputs: InventoryRecord[] = []
      while (outputs.length !== commitments.length) {
        check()
        if (Date.now() >= deadline) throw new Error(`Scanner has not indexed ${transactionId}; reconcile before continuing`)
        const records = await requestRecords(client, { program: plan.asset.program, statusFilter: 'unspent',
          ...(client.account?.type === 'rpc' ? {} : { filter: { commitments } }) })
        outputs = commitments.flatMap((commitment) => {
          const record = records.find((item) => (item.commitment ?? item.recordView?.fields['$commitment']) === commitment)
          const decoded = record && decodeRecord(client, plan.asset, record)
          return decoded ? [decoded] : []
        })
        if (outputs.length !== commitments.length) await pause()
      }
      outputs.forEach((output, index) => {
        if (output.amount !== step.outputs[index]!.amount) throw new Error('Confirmed output amount differs from the plan')
        references.set(step.outputs[index]!.id, output.id)
      })
      result.completedSteps++
    }
  } catch (error) {
    return { ...result, status: 'interrupted', reason: error instanceof Error ? error.message : String(error) }
  }
  return result
}
