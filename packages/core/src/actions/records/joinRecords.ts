import type { Client } from '../../clients/createClient.js'
import type { InventoryRecord, RecordAsset } from '../../inventory/types.js'
import type { ProvingProgressHandler } from '../../types/proving.js'
import { writeContract } from '../wallet/writeContract.js'
import { decodeRecord, maxAmount, recordInput, validateAsset } from './internal.js'

/**
 * Supplies two owned records for a native join.
 * @property asset Program and supported standard.
 * @property records Two distinct records from getRecordInventory.
 * @property onProgress Optional awaited checkpoint callback; defaults to no reporting.
 */
export type JoinRecordsParameters = { asset: RecordAsset; records: [InventoryRecord, InventoryRecord]; onProgress?: ProvingProgressHandler }

/**
 * Joins two records through the asset's native join transition.
 * Signs, proves and submits using the existing account and proving configuration.
 * @param client Wallet client; recordActions enables shared reservations.
 * @param params Two distinct, same-owner records from getRecordInventory.
 * @returns Submitted transaction id; acceptance is asynchronous.
 * @throws On incompatible records, overflow, contention or proving failure.
 * @example
 * const transactionId = await joinRecords(client, { asset, records: [a, b] })
 */
export async function joinRecords(client: Client, params: JoinRecordsParameters): Promise<string> {
  const capabilities = await validateAsset(client, params.asset)
  if (params.records.length !== 2) throw new Error('joinRecords requires two records')
  const records = params.records.map((record) => decodeRecord(client, params.asset, record.record, capabilities))
  const [a, b] = records
  if (!a || !b || a.id === b.id) throw new Error('Join requires distinct eligible records owned by this account')
  if (a.amount + b.amount > maxAmount(params.asset)) throw new Error('Joined amount overflows the token width')
  return writeContract(client, { program: params.asset.program, function: 'join',
    inputs: [recordInput(client, params.asset, a), recordInput(client, params.asset, b)], onProgress: params.onProgress })
}
