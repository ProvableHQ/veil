import type { Client } from '../../clients/createClient.js'
import type { InventoryRecord, RecordAsset } from '../../inventory/types.js'
import { reservedRecordIds } from '../../inventory/internal.js'
import { requestRecords } from '../wallet/requestRecords.js'
import { decodeRecord, recordName, validateAsset } from './internal.js'

/**
 * Scopes an inventory scan to one supported asset.
 * @property asset Program and standard whose eligible records are requested.
 */
export type GetRecordInventoryParameters = { asset: RecordAsset }

/**
 * Reports spendable records separately from records held by other operations.
 * @property available Eligible, unreserved records.
 * @property reserved Eligible records excluded by the shared journal.
 * @property balance Unreserved balance in integer base units.
 */
export type GetRecordInventoryReturnType = { available: InventoryRecord[]; reserved: InventoryRecord[]; balance: bigint }

/**
 * Scans all pages through the client's existing record provider or wallet.
 * Verifies the asset interface and excludes non-token, bound and reserved records.
 * @param client Account client, optionally extended with recordActions.
 * @param params Token program and standard to inspect.
 * @returns Eligible records and their available balance; hits the network.
 * @throws On missing wallet grants, unsupported assets, or a non-terminating scan.
 * @example
 * const inventory = await getRecordInventory(client, { asset: { program: 'credits.aleo', standard: 'credits' } })
 */
export async function getRecordInventory(client: Client, params: GetRecordInventoryParameters): Promise<GetRecordInventoryReturnType> {
  const capabilities = await validateAsset(client, params.asset)
  const excluded = await reservedRecordIds(client)
  const seen = new Map<string, InventoryRecord>()
  let previousPage: string | undefined
  for (let page = 0; ; page++) {
    if (page >= 10_000) throw new Error('Record scan exceeded its page limit')
    const records = await requestRecords(client, {
      program: params.asset.program, statusFilter: 'unspent',
      // Wallets return the program's complete result. Filter locally below so
      // withheld record-name grants cannot silently turn into empty inventory.
      ...(client.account?.type === 'rpc' ? {} : { filter: { records: [recordName(params.asset)], resultsPerPage: 1000, page } }),
    })
    if (client.account?.type !== 'rpc' && records.length > 1000) throw new Error('Record provider ignored pagination; inventory is incomplete')
    const pageKey = JSON.stringify(records.map((record) => record.commitment ?? record.tag ?? record.uid))
    if (records.length === 1000 && pageKey === previousPage) throw new Error('Record provider did not advance pagination; inventory is incomplete')
    previousPage = pageKey
    for (const record of records) {
      const parsed = decodeRecord(client, params.asset, record, capabilities)
      if (parsed && !seen.has(parsed.id)) { seen.set(parsed.id, parsed) }
    }
    if (client.account?.type === 'rpc' || records.length < 1000) break
  }
  const available = [...seen.values()].filter((record) => !excluded.has(record.id))
  const reserved = [...seen.values()].filter((record) => excluded.has(record.id))
  return { available, reserved, balance: available.reduce((sum, record) => sum + record.amount, 0n) }
}
