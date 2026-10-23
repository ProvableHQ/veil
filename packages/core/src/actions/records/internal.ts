import type { Client } from '../../clients/createClient.js'
import type { OwnedRecord, OwnedRecordEncrypted } from '../../types/records.js'
import type { TransactionInput } from '../../types/inputRequest.js'
import type { InventoryRecord, RecordAsset, ResolvedRecordAsset } from '../../inventory/types.js'
import { inventoryRecordId } from '../../inventory/internal.js'
import { parseProgram } from '../../contract/parseProgram.js'
import { checkProgramConformance } from '../../contract/arcConformance.js'
import { getCode } from '../public/getCode.js'
import { parseRecord } from '../../utils/records.js'

/** Returns the credits split deduction, independently of network fees. @internal */
export const splitDeduction = (asset: RecordAsset): bigint => asset.program === 'credits.aleo' ? 10_000n : 0n
/** Selects the resolved amount width, with native defaults for older plans. @internal */
export const amountWidth = (asset: RecordAsset): ResolvedRecordAsset['amountType'] =>
  (asset as Partial<ResolvedRecordAsset>).amountType ?? (asset.program === 'credits.aleo' || asset.amountField === 'microcredits' ? 'u64' : 'u128')
/** Selects the configured record name or the native token default. @internal */
export const recordName = (asset: RecordAsset): string => asset.recordName ?? (asset.program === 'credits.aleo' ? 'credits' : 'Token')
/** Returns the largest representable amount for the selected record field. @internal */
export const maxAmount = (asset: RecordAsset): bigint => (1n << BigInt(amountWidth(asset).slice(1))) - 1n

/** Holds field metadata needed to reject incomplete wallet grants. @internal */
export type AssetCapabilities = { asset: ResolvedRecordAsset; recipientBound: boolean; excluded: boolean }

/** Resolves record defaults and verifies the deployed join/split interface. @internal */
export async function validateAsset(client: Client, asset: RecordAsset): Promise<AssetCapabilities> {
  if (!asset || !/^[a-z][a-z0-9_]*\.aleo$/.test(asset.program)) throw new Error('Invalid asset program')
  for (const name of [asset.recordName, asset.amountField]) {
    if (name !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid record or amount field name')
  }
  if (asset.standard !== undefined && !['credits', 'arc20', 'arc22'].includes(asset.standard)) throw new Error('Unsupported token standard')
  if (asset.standard === 'credits' && asset.program !== 'credits.aleo') throw new Error('Native credits require credits.aleo')
  if (asset.program === 'credits.aleo' && asset.standard && asset.standard !== 'credits') throw new Error('credits.aleo requires the credits standard')
  // Native credits have a fixed record interface. Overrides still need to match it.
  if (asset.program === 'credits.aleo') {
    if ((asset.recordName && asset.recordName !== 'credits') || (asset.amountField && asset.amountField !== 'microcredits')) {
      throw new Error('credits.aleo requires the credits record and microcredits amount field')
    }
    return { asset: { ...asset, standard: 'credits', recordName: 'credits', amountField: 'microcredits', amountType: 'u64' }, recipientBound: false, excluded: false }
  }
  const source = await getCode(client, { programId: asset.program })
  const program = parseProgram(source)
  const join = program.functions.find(fn => fn.name === 'join')
  const split = program.functions.find(fn => fn.name === 'split')
  const joinInput = join?.inputs[0]
  // An explicit record wins. Otherwise follow the native join input, which is
  // Token for ARC programs and can have another name for custom programs.
  const name = asset.recordName ?? (joinInput?.kind === 'record' ? joinInput.type : 'Token')
  const record = program.records.find(record => record.name === name)
  if (!record || program.id !== asset.program) throw new Error(`${asset.program} has an incompatible record join/split interface`)
  const fieldName = asset.amountField ?? ['amount', 'microcredits'].find(name => record.fields.some(field => field.name === name))
  const field = record.fields.find(field => field.name === fieldName)
  if (!field || !/^u(8|16|32|64|128)$/.test(field.type)) throw new Error('Record amount field must be a declared unsigned integer')
  const sameRecord = (input: { kind: string; type?: string }) => input.kind === 'record' && input.type === name
  if (record.fields.find(field => field.name === 'owner')?.type !== 'address' ||
    !join || join.inputs.length !== 2 || !join.inputs.every(sameRecord) || join.outputs.length !== 1 || !join.outputs.every(sameRecord) ||
    !split || split.inputs.length !== 2 || !sameRecord(split.inputs[0]!) || split.inputs[1]?.kind !== 'plaintext' || split.inputs[1].type !== field.type ||
    split.outputs.length !== 2 || !split.outputs.every(sameRecord)) {
    throw new Error(`${asset.program} has an incompatible token join/split interface`)
  }
  // Detect standards only for their default Token balance. A custom field must
  // never inherit eligibility for a helper that sums Token.amount instead.
  let standard = asset.standard
  if (!asset.recordName && !asset.amountField && standard) {
    const report = checkProgramConformance(source, standard as 'arc20' | 'arc22')
    const violations = report.violations.filter(violation =>
      ('fn' in violation && ['join', 'split'].includes(violation.fn)) ||
      ('name' in violation && ['join', 'split', 'Token'].includes(violation.name)) ||
      ('record' in violation && violation.record === 'Token'))
    if (violations.length) throw new Error(`${asset.program} has an incompatible token join/split interface`)
  }
  if (!standard && name === 'Token' && fieldName === 'amount' && field.type === 'u128') {
    standard = (['arc22', 'arc20'] as const).find(candidate =>
      checkProgramConformance(source, candidate).violations.every(violation => violation.kind === 'missing_view'))
  }
  return { asset: { ...asset, ...(standard ? { standard } : {}), recordName: name!, amountField: fieldName!, amountType: field.type as ResolvedRecordAsset['amountType'] },
    recipientBound: record.fields.some(field => field.name === 'recipient_bound'),
    excluded: record.fields.some(field => ['token_id', 'sender', 'recipient'].includes(field.name)) }
}

/** Extracts an eligible owned amount or rejects incomplete wallet grants. @internal */
export function decodeRecord(client: Client, asset: RecordAsset, record: OwnedRecordEncrypted, capabilities?: AssetCapabilities): InventoryRecord | undefined {
  asset = capabilities?.asset ?? asset
  // Declared non-fungible/compliance fields remain excluded even when a wallet
  // omits those fields from its grants. Plaintext checks below cover older plans.
  if (capabilities?.excluded || record.programName !== asset.program || record.spent === true) return undefined
  if (record.recordName && record.recordName !== recordName(asset)) return undefined
  const plaintext = (record as Partial<OwnedRecord>).recordPlaintext
  const field = asset.amountField ?? (asset.program === 'credits.aleo' ? 'microcredits' : 'amount')
  let amount: bigint
  if (plaintext) {
    // Decode the authoritative record body when available; metadata alone must
    // not make another owner's record or a non-fungible record spendable.
    const parsed = parseRecord(plaintext)
    if (parsed.owner !== client.account?.address) return undefined
    // Compliance records and registry records are not fungible ARC Token inventory.
    if (parsed.fields.sender || parsed.fields.recipient || parsed.fields.token_id) return undefined
    if (parsed.fields.recipient_bound?.value === true) return undefined
    const value = parsed.fields[field]
    if (!value || value.type.kind !== 'primitive' || value.type.primitive !== amountWidth(asset) || typeof value.value !== 'bigint') return undefined
    amount = value.value
  } else {
    // Opaque wallet records need explicit grants for every eligibility check.
    // Missing fields must fail instead of making an incomplete balance look empty.
    if (record.recordName !== recordName(asset)) throw new Error('Inventory requires a recordName grant')
    const fields = record.recordView?.fields
    if (capabilities?.recipientBound && fields?.recipient_bound === undefined) throw new Error('Inventory requires a recipient_bound grant for this token')
    if (fields?.recipient_bound === 'true' || fields?.recipient_bound === 'true.private') return undefined
    const raw = fields?.[field]?.replace(/\.(private|public)$/, '')
    const match = new RegExp(`^(\\d+)${amountWidth(asset)}$`).exec(raw ?? '')
    if (!match) throw new Error(`Inventory requires a ${field} grant or record plaintext`)
    amount = BigInt(match[1]!)
  }
  if (amount <= 0n || amount > maxAmount(asset)) return undefined
  return { id: inventoryRecordId(record), amount, record }
}

/** Pins a wallet record by uid or supplies local plaintext to the prover. @internal */
export function recordInput(client: Client, asset: RecordAsset, record: InventoryRecord): TransactionInput {
  // Wallet inputs identify a granted record by uid; local proving instead needs
  // the plaintext literal and must never receive a wallet-only input request.
  if (client.account?.type === 'rpc' && record.record.uid) {
    return { type: 'record', program: asset.program, recordname: recordName(asset), uid: record.record.uid }
  }
  const plaintext = (record.record as Partial<OwnedRecord>).recordPlaintext
  if (!plaintext) throw new Error('Spending requires a wallet uid or record plaintext')
  return plaintext
}
