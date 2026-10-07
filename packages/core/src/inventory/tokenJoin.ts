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
 * @param asset Underlying record program and standard from the reviewed plan.
 * @param step Planned join or split whose outputs must be matched.
 * @param router Optional captured token router; omission expects a native transition.
 * @returns Record commitments in planned output order.
 * @throws When the outer call or dynamic output cannot be matched unambiguously.
 * @example
 * const commitments = inventoryOutputCommitments(transaction, plan.asset, plan.steps[0]!, plan.tokenJoin)
 * @internal
 */
export function inventoryOutputCommitments(transaction: Transaction, asset: RecordAsset, step: InventoryStep, router?: TokenJoinRouter): string[] {
  const transitions = transaction.execution?.transitions ?? []
  const outer = transitions.at(-1)
  const routed = step.kind === 'join' && asset.standard !== 'credits' && router
  if (outer?.program !== (routed ? router.program : asset.program) ||
    outer.function !== (routed ? `join_${step.inputs.length}` : step.kind)) {
    throw new Error('Confirmed transition does not match the inventory plan')
  }
  if (!routed) return (outer.outputs ?? []).filter((output) => output.type === 'record' || output.type === 'record_with_dynamic_id').map((output) => output.id)
  const outputs = outer.outputs ?? []
  if (outputs.length !== 1 || outputs[0]?.type !== 'record_dynamic') throw new Error('Unexpected confirmed router output')
  // A router returns a dynamic id, not a scanner commitment. Only the matching
  // nested token join exposes the encrypted record and its actual commitment.
  const matches = transitions.filter((transition) => transition.program === asset.program && transition.function === 'join')
    .flatMap((transition) => transition.outputs ?? [])
    .filter((output) => output.type === 'record_with_dynamic_id' && output.dynamic_id === outputs[0]!.id)
  if (matches.length !== 1) throw new Error('Cannot resolve confirmed router output to the underlying token commitment')
  return [matches[0]!.id]
}
