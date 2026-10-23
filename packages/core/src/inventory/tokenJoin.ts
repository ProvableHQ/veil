import type { Client } from '../clients/createClient.js'
import type { Transaction } from '../types/transaction.js'
import type { InventoryStep, RecordAsset, TokenJoinRouter } from './types.js'
import { getCode } from '../actions/public/getCode.js'
import { parseProgram } from '../contract/parseProgram.js'

/**
 * Validates a configured router without network calls.
 * @param router Deployed program id and optional input ceiling, defaulting to 15.
 * @returns Maximum inputs per transaction, from 2 to 15.
 * @throws When the program id or input ceiling is invalid.
 * @example
 * const limit = validateTokenJoinRouter({ program: 'main_aj_arc20_2_15.aleo' })
 * @internal
 */
export function validateTokenJoinRouter(router: TokenJoinRouter): number {
  if (!router || !/^[a-z][a-z0-9_]*\.aleo$/.test(router.program)) throw new Error('Invalid token join router program')
  const max = router.maxRecords ?? 15
  if (!Number.isInteger(max) || max < 2 || max > 15) throw new Error('Token join router maxRecords must be from 2 to 15')
  return max
}

/**
 * Verifies the selected deployed router signature before any proof or reservation.
 * Reads the program through the client's transport.
 * @param client Client connected to the router's chain.
 * @param router Program and optional batch ceiling, defaulting to 15 inputs.
 * @param count Number of records to join, from 2 through the configured ceiling.
 * @returns Resolves when the public identifier and dynamic record signature match.
 * @throws On invalid counts, incompatible signatures or transport errors.
 * @example
 * await validateTokenJoinFunction(client, { program: 'main_aj_arc20_2_15.aleo' }, 4)
 * @internal
 */
export async function validateTokenJoinFunction(client: Client, router: TokenJoinRouter, count: number): Promise<void> {
  const max = validateTokenJoinRouter(router)
  if (!Number.isInteger(count) || count < 2 || count > max) throw new Error(`Token join requires 2 to ${max} records`)
  // Validate the deployed join_N entrypoint, including the public token identifier
  // and dynamic record slots, before sending records to a caller-selected router.
  const program = parseProgram(await getCode(client, { programId: router.program }))
  const fn = program.functions.find((item) => item.name === `join_${count}`)
  const identifier = fn?.inputs[0]
  if (program.id !== router.program || !fn || fn.inputs.length !== count + 1 ||
    identifier?.kind !== 'plaintext' || identifier.type !== 'identifier' || identifier.visibility !== 'public' ||
    fn.inputs.slice(1).some((input) => input.kind !== 'dynamicRecord') ||
    fn.outputs.length !== 1 || fn.outputs[0]?.kind !== 'dynamicRecord') {
    throw new Error('Token join router has an incompatible function signature')
  }
}

/**
 * Resolves confirmed inventory outputs to underlying scanner commitments.
 * Computes from the transaction without network calls.
 * @param transaction Accepted execution including nested transitions and the outer call.
 * @param asset Underlying record program from the reviewed plan.
 * @param step Planned join or split whose outputs must be matched.
 * @param router Optional captured dynamic router; omission uses the step helper or native transition.
 * @returns Record commitments in planned output order.
 * @throws When the outer call or nested output cannot be matched unambiguously.
 * @example
 * const commitments = inventoryOutputCommitments(transaction, plan.asset, plan.steps[0]!, plan.tokenJoin)
 * @internal
 */
export function inventoryOutputCommitments(transaction: Transaction, asset: RecordAsset, step: InventoryStep, router?: TokenJoinRouter): string[] {
  const transitions = transaction.execution?.transitions ?? []
  // Nested token calls precede the outer call. Check the outer program and function
  // against the plan before accepting any nested output as this step's result.
  const outer = transitions.at(-1)
  const helper = step.kind === 'join' ? step.joinProgram : undefined
  const routed = step.kind === 'join' && asset.program !== 'credits.aleo' && router
  const target = helper?.program ?? (routed ? router.program : asset.program)
  if (outer?.program !== target ||
    outer.function !== (helper || routed ? `join_${step.inputs.length}` : step.kind)) {
    throw new Error('Confirmed transition does not match the inventory plan')
  }
  // Static helpers return an external commitment. The final nested native join
  // produces the encrypted record that scanners index; earlier joins produce
  // intermediate records consumed within the same transaction.
  if (helper?.inputMode === 'records') {
    const outputs = outer.outputs ?? []
    const finalJoin = transitions.at(-2)
    const joined = finalJoin?.outputs ?? []
    if (outputs.length !== 1 || outputs[0]?.type !== 'external_record' ||
      finalJoin?.program !== asset.program || finalJoin.function !== 'join' ||
      joined.length !== 1 || (joined[0]?.type !== 'record' && joined[0]?.type !== 'record_with_dynamic_id')) {
      throw new Error('Cannot resolve confirmed helper output to the underlying record commitment')
    }
    return [joined[0]!.id]
  }
  // Native joins and splits expose scanner commitments directly.
  if (!helper && !routed) return (outer.outputs ?? []).filter((output) => output.type === 'record' || output.type === 'record_with_dynamic_id').map((output) => output.id)
  const outputs = outer.outputs ?? []
  if (outputs.length !== 1 || outputs[0]?.type !== 'record_dynamic') throw new Error('Unexpected confirmed router output')
  // The outer dynamic id is a commitment for the router's own return slot. It
  // need not equal the nested output's dynamic_id. The final native join holds
  // the encrypted result and the record commitment used by the scanner.
  const finalJoin = transitions.at(-2)
  const joined = finalJoin?.outputs ?? []
  if (finalJoin?.program !== asset.program || finalJoin.function !== 'join' ||
    joined.length !== 1 || joined[0]?.type !== 'record_with_dynamic_id') {
    throw new Error('Cannot resolve confirmed router output to the underlying token commitment')
  }
  return [joined[0]!.id]
}
