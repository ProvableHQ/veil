import type { Client } from '../clients/createClient.js'
import type { ProgramFunction } from '../types/program.js'
import type { RecordJoinProgram, ResolvedRecordAsset } from './types.js'
import { getCode } from '../actions/public/getCode.js'
import { parseProgram } from '../contract/parseProgram.js'
import { recordSettings } from './internal.js'

const counts = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, index) => min + index)
// Static helper deployments divide their join functions into three size ranges.
const wrappers = (prefix: string): readonly RecordJoinProgram[] => [[2, 10], [11, 14], [15, 16]].map(([min, max]) => ({
  program: `${prefix}_${min}_${max}.aleo`, inputMode: 'records', counts: counts(min!, max!),
}))
const arc = (network: 'mainnet' | 'testnet'): readonly RecordJoinProgram[] => [{
  program: `${network === 'mainnet' ? 'main' : 'test'}_aj_arc20_2_15.aleo`, inputMode: 'programIdentifierThenRecords', counts: counts(2, 15),
}]

/**
 * Lists known join helpers by network and source program, with ARC defaults.
 * Exact program entries take precedence over the arc20/arc22 entries. Selection
 * verifies each helper's deployed ABI through the client's transport; the list
 * alone does not establish that a helper is available on a particular node.
 * @example
 * const candidates = recordJoinPrograms.testnet['credits.aleo']
 */
export const recordJoinPrograms: Readonly<Record<'mainnet' | 'testnet', Readonly<Record<string, readonly RecordJoinProgram[]>>>> = {
  mainnet: {
    'credits.aleo': wrappers('autojoin_credits'),
    'usad_stablecoin.aleo': wrappers('aj_usad_stablecoin'),
    'usdcx_stablecoin.aleo': wrappers('aj_usdcx_stablecoin'),
    arc20: arc('mainnet'), arc22: arc('mainnet'),
  },
  testnet: {
    'credits.aleo': wrappers('autojoin_credits'),
    'test_usad_stablecoin.aleo': wrappers('aj_test_usad_stablecoin'),
    'test_usdcx_stablecoin.aleo': wrappers('aj_test_usdcx_stablecoin'),
    arc20: arc('testnet'), arc22: arc('testnet'),
  },
}

/**
 * Validates helper metadata without contacting a node.
 * @param helper Program, input convention, and supported record counts.
 * @returns Nothing when all counts fit the helper's input convention.
 * @throws On invalid program ids, duplicate counts, or counts outside 2 to 16 (15 for dynamic helpers).
 * @example
 * validateRecordJoinProgram({ program: 'autojoin_credits_2_10.aleo', inputMode: 'records', counts: [3] })
 * @internal
 */
export function validateRecordJoinProgram(helper: RecordJoinProgram): void {
  if (!helper || !/^[a-z][a-z0-9_]*\.aleo$/.test(helper.program) ||
    !['records', 'programIdentifierThenRecords'].includes(helper.inputMode) ||
    !Array.isArray(helper.counts) || !helper.counts.length || new Set(helper.counts).size !== helper.counts.length ||
    helper.counts.some(count => !Number.isInteger(count) || count < 2 || count > (helper.inputMode === 'records' ? 16 : 15))) {
    throw new Error('Invalid record join helper configuration')
  }
}

/** Checks that a helper accepts the selected record type and returns one record. @internal */
function compatible(fn: ProgramFunction | undefined, asset: ResolvedRecordAsset, helper: RecordJoinProgram, count: number): boolean {
  if (!fn || fn.outputs.length !== 1) return false
  if (helper.inputMode === 'programIdentifierThenRecords') {
    // Dynamic ARC helpers call Token.join and sum amount. Field overrides must
    // not send a different record or balance through that interface.
    const first = fn.inputs[0]
    return asset.recordName === 'Token' && asset.amountField === 'amount' && asset.amountType === 'u128' &&
      fn.inputs.length === count + 1 && first?.kind === 'plaintext' && first.type === 'identifier' && first.visibility === 'public' &&
      fn.inputs.slice(1).every(input => input.kind === 'dynamicRecord') && fn.outputs[0]?.kind === 'dynamicRecord'
  }
  const externalRecord = `${asset.program}/${asset.recordName}`
  return fn.inputs.length === count && fn.inputs.every(input => input.kind === 'record' && input.type === externalRecord) &&
    fn.outputs[0]?.kind === 'record' && fn.outputs[0].type === externalRecord
}

/**
 * Finds available helpers for an asset without signing or reserving records.
 * @param client Client whose transport supplies the network and deployed program source.
 * @param asset Resolved record and amount field to match against helper inputs.
 * @returns Compatible deployed helpers; empty when disabled, missing, or unsupported on the network.
 * @throws On transport failures other than a missing deployment.
 * @example
 * const helpers = await getRecordJoinPrograms(client, inventory.asset)
 * @internal
 */
export async function getRecordJoinPrograms(client: Client, asset: ResolvedRecordAsset): Promise<RecordJoinProgram[]> {
  const configured = recordSettings(client).tokenJoin
  // Explicit dynamic routing is handled by the existing tokenJoin option.
  if (configured === false || (configured && asset.program !== 'credits.aleo')) return []
  const network = client.transport.config.network
  if (network !== 'mainnet' && network !== 'testnet') return []
  const defaultsMatch = asset.program === 'credits.aleo'
    ? asset.recordName === 'credits' && asset.amountField === 'microcredits'
    : asset.recordName === 'Token' && asset.amountField === 'amount' && asset.amountType === 'u128'
  if (!defaultsMatch) return []
  const registry = network === 'mainnet' ? recordJoinPrograms.mainnet : recordJoinPrograms.testnet
  const candidates = registry[asset.program] ?? (asset.standard ? registry[asset.standard] : undefined) ?? []
  const available: RecordJoinProgram[] = []
  for (const helper of candidates) {
    let source: string
    try { source = await getCode(client, { programId: helper.program }) }
    catch (error) {
      // Missing deployments permit native joins. Transport outages must still
      // surface instead of silently changing the planned transaction count.
      if ((error as { status?: number }).status === 404) continue
      throw error
    }
    if (typeof source !== 'string') continue
    const program = parseProgram(source)
    if (program.id !== helper.program) continue
    const supported = helper.counts.filter(count => compatible(program.functions.find(fn => fn.name === `join_${count}`), asset, helper, count))
    if (supported.length) available.push({ ...helper, counts: supported })
  }
  return available
}

/**
 * Rechecks the captured helper ABI immediately before submitting its inputs.
 * @param client Client connected to the helper's chain.
 * @param asset Resolved asset whose records will be joined.
 * @param helper Selected deployment and supported input counts.
 * @param count Number of consumed records, bounded by the helper's supported counts.
 * @returns Resolves when the deployed function accepts and returns the selected record type.
 * @throws On an unsupported count, incompatible signature, or failed program lookup.
 * @example
 * await validateRecordJoinFunction(client, inventory.asset, helper, 3)
 * @internal
 */
export async function validateRecordJoinFunction(client: Client, asset: ResolvedRecordAsset, helper: RecordJoinProgram, count: number): Promise<void> {
  validateRecordJoinProgram(helper)
  if (!helper.counts.includes(count)) throw new Error('Record count is outside the join helper limits')
  const program = parseProgram(await getCode(client, { programId: helper.program }))
  if (program.id !== helper.program || !compatible(program.functions.find(fn => fn.name === `join_${count}`), asset, helper, count)) {
    throw new Error('Record join helper has an incompatible function signature')
  }
}
