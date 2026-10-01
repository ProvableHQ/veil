import type { Client } from '../clients/createClient.js'
import type { OwnedRecordEncrypted, OwnedRecord } from '../types/records.js'
import { parseRecord } from '../utils/records.js'
import type { RecordActionsConfig, RecordInventoryStore } from './types.js'
import { holdsRecords } from './store.js'

/**
 * Carries the coordination context attached by recordActions.
 * @property chainId Stable chain identity for reservation scopes.
 * @property store Shared atomic journal.
 * @property maxFeeMicrocredits Optional proved fee ceiling; absent means no limit.
 * @property network Original transport network, checked against later network switches.
 * @internal
 */
export type RecordManagement = Required<Pick<RecordActionsConfig, 'chainId'>> & {
  store: RecordInventoryStore
  maxFeeMicrocredits?: bigint
  network: string | null | undefined
}

/** Reads coordination settings and rejects a transport that switched networks. @internal */
export function management(client: Client): RecordManagement | undefined {
  const config = (client as Client & { recordManagement?: RecordManagement }).recordManagement
  if (config && config.network !== client.transport.config.network) {
    throw new Error('Record management network changed; rebuild recordActions for the new chain')
  }
  return config
}

/** Derives the reservation namespace from the active chain and account address. @internal */
export function scopeOf(client: Client): string {
  const chain = management(client)?.chainId ?? client.transport.config.network
  if (!chain || !client.account?.address) throw new Error('Inventory requires an account address and chain identity')
  return JSON.stringify([chain, client.account.address])
}

/**
 * Returns a record nonce shared by local scanning and wallet field grants.
 * @param record Owned record exposing plaintext or the granted $nonce metadata field.
 * @returns Stable nonce for reservation, independent of connection-specific wallet uids.
 * @throws When the record's identity was not granted.
 * @example
 * const id = inventoryRecordId(record)
 */
export function inventoryRecordId(record: OwnedRecordEncrypted): string {
  const plaintext = (record as Partial<OwnedRecord>).recordPlaintext
  const nonce = plaintext ? parseRecord(plaintext).nonce : record.recordView?.fields['$nonce']?.replace(/\.public$/, '')
  if (!nonce || !/^\d+group$/.test(nonce)) throw new Error('Inventory requires record plaintext or a $nonce grant')
  return nonce
}

/**
 * Lists nonces held by pending or confirmed operations, including stale scanner inputs.
 * @param client Client extended with recordActions; returns an empty set otherwise.
 * @returns Nonces excluded from selection. Reads the configured journal.
 * @example
 * const excluded = await reservedRecordIds(client)
 */
export async function reservedRecordIds(client: Client): Promise<Set<string>> {
  const config = management(client)
  if (!config) return new Set()
  return new Set((await config.store.list(scopeOf(client))).filter(holdsRecords).flatMap((entry) => entry.records))
}

/** Enforces positive bounded integers; the default upper bound is 1000. @internal */
export function positiveInteger(value: number, name: string, max = 1000): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer from 1 to ${max}`)
}
