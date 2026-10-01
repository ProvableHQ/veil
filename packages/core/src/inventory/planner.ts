import type { InventoryPlan, InventoryStep, InventoryTarget, RecordAsset } from './types.js'
import { positiveInteger } from './internal.js'
import { maxAmount, splitDeduction } from '../actions/records/internal.js'

/**
 * Computes a deterministic join/split dependency plan without network calls.
 * @param params Scoped record amounts, target shape and optional operation ceiling (default 100).
 * @returns A plaintext-free plan with intrinsic credits split deductions.
 * @throws On invalid bounds, infeasible targets, intermediate overflow or too many operations.
 * @internal
 */
export function buildInventoryPlan(params: {
  scope: string; asset: RecordAsset; target: InventoryTarget
  inputs: { id: string; amount: bigint }[]; maxTransactions?: number
}): InventoryPlan {
  const { asset } = params
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
  const balanced = () => working.every((record) => {
    const difference = record.amount * BigInt(target.records) - total
    const absolute = difference < 0n ? -difference : difference
    // One base unit of rounding never warrants another transaction.
    return absolute <= BigInt(target.records) || absolute * 10_000n <= total * BigInt(tolerance)
  })
  const satisfied = working.length === target.records && working.every((record) => record.amount >= min) &&
    (target.distribution !== 'balanced' || balanced())
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
      return { scope: params.scope, asset: { ...asset }, target, inputs, steps,
        deduction: steps.reduce((sum, step) => sum + step.deduction, 0n), maxTransactions }
    }
  }
  if (!satisfied) {
    if (!working.length || total < BigInt(target.records) * min) throw new Error('Insufficient available inventory for target')
    // Repack only when existing records cannot be preserved: balanced layouts or undersized records.
    const capacity = working.reduce((sum, record) => sum + (record.amount + splitDeduction(asset)) / (min + splitDeduction(asset)), 0n)
    const repack = target.distribution === 'balanced' || working.some((record) => record.amount < min) || capacity < BigInt(target.records)
    const reduceTo = repack ? 1 : target.records
    while (working.length > reduceTo) {
      working.sort((a, b) => a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : a.id.localeCompare(b.id))
      const [a, b] = working
      // Intermediate joins can be below the output minimum while accumulating dust.
      const amount = a!.amount + b!.amount
      if (amount > maxAmount(asset)) throw new Error('Join would overflow the asset amount width')
      const output = { id: `step:${steps.length}:0`, amount }
      if (steps.length >= maxTransactions) throw new Error('Inventory plan exceeds maxTransactions')
      steps.push({ kind: 'join', inputs: [a!.id, b!.id], outputs: [output], deduction: 0n })
      working = working.slice(2).concat(output)
    }
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
  return { scope: params.scope, asset: { ...asset }, target, inputs, steps,
    deduction: steps.reduce((sum, step) => sum + step.deduction, 0n), maxTransactions }
}
