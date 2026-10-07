import type { Client } from '../../clients/createClient.js'
import type { InventoryRecord, RecordAsset } from '../../inventory/types.js'
import type { ProvingProgressHandler } from '../../types/proving.js'
import { writeContract } from '../wallet/writeContract.js'
import { decodeRecord, maxAmount, recordInput, validateAsset } from './internal.js'
import { management } from '../../inventory/internal.js'
import { validateTokenJoinFunction } from '../../inventory/tokenJoin.js'

/**
 * Supplies owned records for a native or configured batch join.
 * @property asset Program and supported standard.
 * @property records Distinct records from getRecordInventory; exactly two for native joins, 2–15 with a token router.
 * @property onProgress Optional awaited checkpoint callback; defaults to no reporting.
 */
export type JoinRecordsParameters = { asset: RecordAsset; records: InventoryRecord[]; onProgress?: ProvingProgressHandler }

/**
 * Joins records through a native transition or the configured token router.
 * Signs, proves and submits using the existing account and proving configuration.
 * @param client Wallet client; recordActions enables shared reservations.
 * @param params Distinct, same-owner records from getRecordInventory, within the configured batch limit.
 * @returns Submitted transaction id; acceptance is asynchronous.
 * @throws On incompatible records, overflow, contention or proving failure.
 * @example
 * const transactionId = await joinRecords(client, { asset, records: [a, b] })
 */
export async function joinRecords(client: Client, params: JoinRecordsParameters): Promise<string> {
  const capabilities = await validateAsset(client, params.asset)
  const router = params.asset.standard !== 'credits' ? management(client)?.tokenJoin : undefined
  if (router) await validateTokenJoinFunction(client, router, params.records.length)
  else if (params.records.length !== 2) throw new Error('joinRecords requires two records without a token router')
  const records = params.records.map((record) => decodeRecord(client, params.asset, record.record, capabilities))
  if (records.some((record) => !record) || new Set(records.map((record) => record?.id)).size !== records.length) {
    throw new Error('Join requires distinct eligible records owned by this account')
  }
  const eligible = records as InventoryRecord[]
  if (eligible.reduce((sum, record) => sum + record.amount, 0n) > maxAmount(params.asset)) throw new Error('Joined amount overflows the token width')
  return writeContract(client, { program: router?.program ?? params.asset.program, function: router ? `join_${records.length}` : 'join',
    inputs: [...(router ? [`'${params.asset.program.slice(0, -5)}'`] : []), ...eligible.map((record) => recordInput(client, params.asset, record))],
    ...(router ? { imports: [params.asset.program] } : {}), onProgress: params.onProgress })
}
