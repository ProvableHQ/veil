import type { Client } from '../../clients/createClient.js'
import type { OwnedRecord, OwnedRecordEncrypted } from '../../types/records.js'
import type { TransactionInput } from '../../types/inputRequest.js'
import type { InventoryRecord, RecordAsset } from '../../inventory/types.js'
import { inventoryRecordId } from '../../inventory/internal.js'
import { parseProgram } from '../../contract/parseProgram.js'
import { checkProgramConformance } from '../../contract/arcConformance.js'
import { getCode } from '../public/getCode.js'
import { parseRecord } from '../../utils/records.js'

/** Returns the intrinsic split deduction in base units, independently of network fees. @internal */
export const splitDeduction = (asset: RecordAsset): bigint => asset.standard === 'credits' ? 10_000n : 0n
/** Selects the native amount width for record parsing and encoded inputs. @internal */
export const amountWidth = (asset: RecordAsset): 'u64' | 'u128' => asset.standard === 'credits' ? 'u64' : 'u128'
/** Selects the native record type for the scanner filter. @internal */
export const recordName = (asset: RecordAsset): string => asset.standard === 'credits' ? 'credits' : 'Token'
/** Returns the largest representable record amount for this asset. @internal */
export const maxAmount = (asset: RecordAsset): bigint => (1n << (asset.standard === 'credits' ? 64n : 128n)) - 1n

/** Verifies the deployed join/split interface and reports required field grants. @internal */
export async function validateAsset(client: Client, asset: RecordAsset): Promise<{ recipientBound: boolean }> {
  if (!asset || !/^[a-z][a-z0-9_]*\.aleo$/.test(asset.program)) throw new Error('Invalid asset program')
  if (asset.standard === 'credits') {
    if (asset.program !== 'credits.aleo') throw new Error('Native credits require credits.aleo')
    return { recipientBound: false }
  }
  if (asset.standard !== 'arc20' && asset.standard !== 'arc22') throw new Error('Unsupported token standard')
  const source = await getCode(client, { programId: asset.program })
  const report = checkProgramConformance(source, asset.standard)
  // Inventory depends on the Token and join/split interface, not transfer views.
  // Deployed stablecoins can expose these capabilities without newer read accessors.
  const violations = report.violations.filter((violation) =>
    ('fn' in violation && ['join', 'split'].includes(violation.fn)) ||
    ('name' in violation && ['join', 'split', 'Token'].includes(violation.name)) ||
    ('record' in violation && violation.record === 'Token'))
  if (report.programId !== asset.program || violations.length) throw new Error(`${asset.program} has an incompatible token join/split interface`)
  return { recipientBound: parseProgram(source).records.find((record) => record.name === 'Token')?.fields.some((field) => field.name === 'recipient_bound') ?? false }
}

/** Extracts an eligible owned amount or rejects incomplete wallet grants. @internal */
export function decodeRecord(client: Client, asset: RecordAsset, record: OwnedRecordEncrypted, capabilities?: { recipientBound: boolean }): InventoryRecord | undefined {
  if (record.programName !== asset.program || record.spent === true) return undefined
  if (record.recordName && record.recordName !== recordName(asset)) return undefined
  const plaintext = (record as Partial<OwnedRecord>).recordPlaintext
  const field = asset.standard === 'credits' ? 'microcredits' : 'amount'
  let amount: bigint
  if (plaintext) {
    const parsed = parseRecord(plaintext)
    if (parsed.owner !== client.account?.address) return undefined
    // Compliance records and registry records are not fungible ARC Token inventory.
    if (parsed.fields.sender || parsed.fields.recipient || parsed.fields.token_id) return undefined
    if (parsed.fields.recipient_bound?.value === true) return undefined
    const value = parsed.fields[field]
    if (!value || value.type.kind !== 'primitive' || value.type.primitive !== amountWidth(asset) || typeof value.value !== 'bigint') return undefined
    amount = value.value
  } else {
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
  if (client.account?.type === 'rpc' && record.record.uid) {
    return { type: 'record', program: asset.program, recordname: recordName(asset), uid: record.record.uid }
  }
  const plaintext = (record.record as Partial<OwnedRecord>).recordPlaintext
  if (!plaintext) throw new Error('Spending requires a wallet uid or record plaintext')
  return plaintext
}
