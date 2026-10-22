import type { InventoryPlan, InventoryStep, InventoryTarget, RecordAsset, TokenJoinRouter, RecordJoinProgram } from './types.js'
import { positiveInteger } from './internal.js'
import { maxAmount, splitDeduction } from '../actions/records/internal.js'
import { validateTokenJoinRouter } from './tokenJoin.js'
import { validateRecordJoinProgram } from './joinPrograms.js'

/**
 * Computes a deterministic join/split dependency plan without network calls.
 * @param params Scoped record amounts, target count/distribution and optional operation ceiling (default 100).
 * @returns A plaintext-free plan with intrinsic credits split deductions.
 * @throws On invalid bounds, infeasible targets, intermediate overflow or too many operations.
 * @internal
 */
export function buildInventoryPlan(params: {
  scope: string; asset: RecordAsset; target: InventoryTarget
  inputs: { id: string; amount: bigint }[]; maxTransactions?: number; tokenJoin?: TokenJoinRouter | false; joinPrograms?: RecordJoinProgram[]
}): InventoryPlan {
  // Capture the requested policy and validate bounds before simulating any steps.
  const { asset } = params
  if (params.tokenJoin) validateTokenJoinRouter(params.tokenJoin)
  const tokenJoin = asset.program !== 'credits.aleo' && params.tokenJoin ? { ...params.tokenJoin } : undefined
  const joinPrograms = params.joinPrograms?.map(helper => {
    validateRecordJoinProgram(helper)
    return { ...helper, counts: [...helper.counts] }
  })
  const routing = { ...(tokenJoin ? { tokenJoin } : {}), ...(joinPrograms?.length ? { joinPrograms } : {}) }
  const maxJoinRecords = tokenJoin ? validateTokenJoinRouter(tokenJoin) : 2
  const target = { ...params.target }
  positiveInteger(target.records, 'records')
  const maxTransactions = params.maxTransactions ?? 100
  positiveInteger(maxTransactions, 'maxTransactions', 10_000)
  const min = target.minRecordAmount ?? 1n
  const tolerance = target.toleranceBps ?? 1000
  if (typeof min !== 'bigint' || min < 1n || min > maxAmount(asset)) throw new Error('Invalid minimum record amount')
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 10_000) throw new Error('Invalid balance tolerance')
  if (target.distribution && !['preserve', 'balanced'].includes(target.distribution)) throw new Error('Invalid inventory distribution')
  const inputs = params.inputs.map((record) => ({ ...record }))
  if (new Set(inputs.map((record) => record.id)).size !== inputs.length) throw new Error('Duplicate inventory records')
  if (inputs.some((record) => record.amount <= 0n || record.amount > maxAmount(asset))) throw new Error('Invalid record amount')
  let working = inputs.map((record) => ({ ...record }))
  const steps: InventoryStep[] = []
  const total = working.reduce((sum, record) => sum + record.amount, 0n)
  // Compare against the ideal equal share using integer arithmetic so fractional
  // base units cannot introduce rounding drift into the tolerance check.
  const balanced = () => working.every((record) => {
    const difference = record.amount * BigInt(target.records) - total
    const absolute = difference < 0n ? -difference : difference
    // One base unit of rounding never warrants another transaction.
    return absolute <= BigInt(target.records) || absolute * 10_000n <= total * BigInt(tolerance)
  })
  const satisfied = working.length === target.records && working.every((record) => record.amount >= min) &&
    (target.distribution !== 'balanced' || balanced())
  // Replace consumed records with symbolic outputs that later steps can reference.
  // These ids describe dependencies; execution resolves them to confirmed records.
  const push = (kind: 'join' | 'split', consumed: typeof working, amounts: bigint[], amount?: bigint) => {
    if (steps.length >= maxTransactions) throw new Error('Inventory plan exceeds maxTransactions')
    if (amounts.some((value) => value < min || value > maxAmount(asset))) throw new Error('Inventory target is infeasible within token amount bounds')
    const outputs = amounts.map((value, index) => ({ id: `step:${steps.length}:${index}`, amount: value }))
    steps.push({ kind, inputs: consumed.map((record) => record.id), outputs, amount, deduction: kind === 'split' ? splitDeduction(asset) : 0n })
    const ids = new Set(consumed.map((record) => record.id))
    working = working.filter((record) => !ids.has(record.id)).concat(outputs)
  }
  // Preserve exact lots when larger records can be split directly into the
  // missing lots. This avoids a consolidate-and-split round trip for [25,25,50].
  if (!satisfied && target.distribution === 'balanced' && working.length < target.records) {
    const deduction = splitDeduction(asset)
    // Each split adds one record and may deduct credits; compute the final lot size
    // after all required deductions before deciding whether existing lots can stay.
    const finalTotal = total - deduction * BigInt(target.records - working.length)
    const unit = finalTotal / BigInt(target.records)
    if (unit >= min && finalTotal % BigInt(target.records) === 0n &&
      working.every((record) => (record.amount + deduction) % (unit + deduction) === 0n)) {
      const original = [...working]
      for (const originalRecord of original) {
        let record = originalRecord
        while (record.amount > unit) {
          push('split', [record], [unit, record.amount - unit - deduction], unit)
          record = steps.at(-1)!.outputs[1]!
        }
      }
      return { scope: params.scope, asset: { ...asset }, target, inputs, steps, ...routing,
        deduction: steps.reduce((sum, step) => sum + step.deduction, 0n), maxTransactions }
    }
  }
  if (!satisfied) {
    if (!working.length || total < BigInt(target.records) * min) throw new Error('Insufficient available inventory for target')
    // Repack only when existing records cannot be preserved: balanced layouts or undersized records.
    const capacity = working.reduce((sum, record) => sum + (record.amount + splitDeduction(asset)) / (min + splitDeduction(asset)), 0n)
    const repack = target.distribution === 'balanced' || working.some((record) => record.amount < min) || capacity < BigInt(target.records)
    const reduceTo = repack ? 1 : target.records
    // Join the smallest records first, with record ids breaking equal-amount
    // ties so rebuilding the same plan produces the same dependency sequence.
    while (working.length > reduceTo) {
      working.sort((a, b) => a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : a.id.localeCompare(b.id))
      const needed = working.length - reduceTo + 1
      // Prefer the largest available helper that preserves the requested count.
      // A final pair uses the native join unless tokenJoin was explicitly set.
      const helperCount = Math.max(2, ...(joinPrograms ?? []).flatMap(helper => helper.counts.filter(count => count <= needed)))
      let count = Math.min(tokenJoin ? maxJoinRecords : helperCount, needed)
      let amount = working.slice(0, count).reduce((sum, record) => sum + record.amount, 0n)
      // Reduce the batch if its amount would overflow or its exact arity is unavailable.
      while (count > 2 && (amount > maxAmount(asset) || (!tokenJoin && !joinPrograms?.some(helper => helper.counts.includes(count))))) {
        amount -= working[--count]!.amount
      }
      const helper = !tokenJoin && count > 2 ? joinPrograms?.find(helper => helper.counts.includes(count)) : undefined
      const consumed = working.slice(0, count)
      // Intermediate joins can be below the output minimum while accumulating dust.
      if (amount > maxAmount(asset)) throw new Error('Join would overflow the asset amount width')
      const output = { id: `step:${steps.length}:0`, amount }
      if (steps.length >= maxTransactions) throw new Error('Inventory plan exceeds maxTransactions')
      steps.push({ kind: 'join', ...(helper ? { joinProgram: { ...helper, counts: [...helper.counts] } } : {}), inputs: consumed.map((record) => record.id), outputs: [output], deduction: 0n })
      working = working.slice(count).concat(output)
    }
    // Split the largest remaining record and leave enough value in its remainder
    // for any dependent splits, including their intrinsic credits deductions.
    while (working.length < target.records) {
      working.sort((a, b) => a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : a.id.localeCompare(b.id))
      const record = working[0]!
      const outputsNeeded = repack ? target.records - working.length + 1 : 2
      const deduction = splitDeduction(asset)
      const usable = record.amount - deduction * BigInt(outputsNeeded - 1)
      const amount = usable / BigInt(outputsNeeded)
      push('split', [record], [amount, record.amount - amount - deduction], amount)
    }
    if (working.some((record) => record.amount < min)) throw new Error('Insufficient balance after split deductions')
  }
  return { scope: params.scope, asset: { ...asset }, target, inputs, steps, ...routing,
    deduction: steps.reduce((sum, step) => sum + step.deduction, 0n), maxTransactions }
}
