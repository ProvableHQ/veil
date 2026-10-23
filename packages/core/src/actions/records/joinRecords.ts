import type { Client } from '../../clients/createClient.js'
import type { InventoryRecord, RecordAsset, RecordJoinProgram } from '../../inventory/types.js'
import type { ProvingProgressHandler } from '../../types/proving.js'
import { writeContract } from '../wallet/writeContract.js'
import { decodeRecord, maxAmount, recordInput, validateAsset } from './internal.js'
import { management, recordSettings } from '../../inventory/internal.js'
import { validateTokenJoinFunction, validateTokenJoinRouter } from '../../inventory/tokenJoin.js'
import { getRecordJoinPrograms, validateRecordJoinFunction } from '../../inventory/joinPrograms.js'

/**
 * Supplies owned records for a native or configured batch join.
 * @property asset Program with optional record-name and amount-field overrides.
 * @property records Distinct records from getRecordInventory; exactly two natively, up to 16 with static helpers or 15 with dynamic ARC helpers.
 * @property joinProgram Optional helper override. Omission selects an available helper for more than two records; false uses the native join.
 * @property onProgress Optional awaited checkpoint callback; defaults to no reporting.
 */
export type JoinRecordsParameters = { asset: RecordAsset; records: InventoryRecord[]; joinProgram?: RecordJoinProgram | false; onProgress?: ProvingProgressHandler }

/**
 * Joins records through the native transition or an available batch helper.
 * Signs, proves and submits using the existing account and proving configuration.
 * @param client Wallet client; recordManagement.enabled opts into shared reservations.
 * @param params Distinct, same-owner records from getRecordInventory, within the configured batch limit.
 * @returns Submitted transaction id; acceptance is asynchronous.
 * @throws On incompatible records, overflow, contention or proving failure.
 * @example
 * import { getRecordInventory, joinRecords, waitForConfirmation, type Client } from '@provablehq/veil-core'
 *
 * async function joinTwoCreditsRecords(client: Client) {
 *   // Configure recordManagement.enabled with a shared store before calling
 *   // this from concurrent workers; the scan itself does not reserve inputs.
 *   const asset = { program: 'credits.aleo' }
 *   const inventory = await getRecordInventory(client, { asset })
 *   const records = inventory.available.slice(0, 2)
 *   if (records.length !== 2) throw new Error('Two available credits records are required')
 *
 *   const transactionId = await joinRecords(client, {
 *     asset, records, joinProgram: false, // Force the native two-record join.
 *   })
 *   await waitForConfirmation(client, transactionId, 120_000)
 *   // Confirmation can precede scanner visibility. Use autoJoin when a
 *   // dependent operation needs the exact joined output to become readable.
 *   return transactionId
 * }
 *
 * // To join more than two records in one transaction, omit joinProgram and
 * // supply a count supported by an available helper. Use autoJoin when the
 * // inventory needs several helper calls or native two-record joins.
 */
export async function joinRecords(client: Client, params: JoinRecordsParameters): Promise<string> {
  const capabilities = await validateAsset(client, params.asset)
  const asset = capabilities.asset
  const router = asset.program !== 'credits.aleo' ? recordSettings(client).tokenJoin : undefined
  let helper = params.joinProgram
  if (helper === undefined && router) {
    const max = validateTokenJoinRouter(router)
    await validateTokenJoinFunction(client, router, params.records.length)
    helper = { program: router.program, inputMode: 'programIdentifierThenRecords', counts: Array.from({ length: max - 1 }, (_, i) => i + 2) }
  } else if (helper === undefined && params.records.length > 2) {
    helper = (await getRecordJoinPrograms(client, asset)).find(helper => helper.counts.includes(params.records.length))
  }
  if (helper) await validateRecordJoinFunction(client, asset, helper, params.records.length)
  else if (params.records.length !== 2) throw new Error('joinRecords requires two records without an available join helper; use autoJoin for multiple transactions')
  // Re-decode the supplied records before proving; cached inventory amounts are
  // not sufficient to establish ownership, eligibility, or distinct inputs.
  const records = params.records.map((record) => decodeRecord(client, params.asset, record.record, capabilities))
  if (records.some((record) => !record) || new Set(records.map((record) => record?.id)).size !== records.length) {
    throw new Error('Join requires distinct eligible records owned by this account')
  }
  const eligible = records as InventoryRecord[]
  if (eligible.reduce((sum, record) => sum + record.amount, 0n) > maxAmount(asset)) throw new Error('Joined amount overflows the token width')
  // Attribute helper calls to the source asset in the journal so maintenance
  // budgets and cooldowns include both native and helper transactions.
  const config = management(client)
  const spendClient = helper && config ? Object.assign(Object.create(client), {
    recordManagement: { ...config, joinAsset: { program: helper.program, assetProgram: asset.program } },
  }) as Client : client
  const dynamic = helper && helper.inputMode === 'programIdentifierThenRecords'
  return writeContract(spendClient, { program: helper ? helper.program : asset.program, function: helper ? `join_${records.length}` : 'join',
    inputs: [...(dynamic ? [`'${asset.program.slice(0, -5)}'`] : []), ...eligible.map(record => recordInput(client, asset, record))],
    ...(dynamic ? { imports: [asset.program] } : {}), onProgress: params.onProgress })
}
