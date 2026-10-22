import type { Client } from '../clients/createClient.js'
import type { OwnedRecordEncrypted, OwnedRecord } from '../types/records.js'
import { parseRecord } from '../utils/records.js'
import type { RecordActionsConfig, RecordManagementConfig, RecordInventoryStore } from './types.js'
import { holdsRecords, memoryRecordInventoryStore } from './store.js'
import { validateTokenJoinRouter } from './tokenJoin.js'
import type { Transport } from '../types/transport.js'

/**
 * Holds the enabled client's journal, limits, and chain settings.
 * @property enabled Records that the caller enabled reservations and recovery.
 * @property chainId Stable chain identity for reservation scopes.
 * @property store Shared atomic journal.
 * @property maxFeeMicrocredits Optional proved fee ceiling; absent means no limit.
 * @property tokenJoin Optional dynamic ARC router override; omission selects available helpers and false disables helpers.
 * @property joinAsset Internal source-asset attribution for a validated helper call.
 * @property network Original transport network, checked against later network switches.
 * @internal
 */
export type RecordManagement = Required<Pick<RecordActionsConfig, 'chainId'>> & {
  enabled: true
  store: RecordInventoryStore
  maxFeeMicrocredits?: bigint
  tokenJoin?: RecordActionsConfig['tokenJoin']
  joinAsset?: { program: string; assetProgram: string }
  network: string | null | undefined
}

/**
 * Resolves record settings before wallet actions capture the client.
 * Disabled configuration creates no store and skips validation of write restrictions.
 * @internal
 */
export function configureRecordManagement(config: RecordManagementConfig | undefined, transport: Transport): RecordManagementConfig | undefined {
  if (!config) return undefined
  // Copy caller-owned options so later mutation cannot switch a live client's scope.
  const tokenJoin = config.tokenJoin && { ...config.tokenJoin }
  if (config.enabled !== true) return { ...config, tokenJoin }
  const chainId = config.chainId ?? transport.config.network
  if (!chainId) throw new Error('recordManagement requires chainId on a transport without a network')
  if (config.maxFeeMicrocredits !== undefined && config.maxFeeMicrocredits < 0n) throw new Error('Fee limit cannot be negative')
  if (tokenJoin) validateTokenJoinRouter(tokenJoin)
  const resolved: RecordManagement = {
    ...config, enabled: true, chainId, tokenJoin,
    store: config.store ?? memoryRecordInventoryStore(), network: transport.config.network,
  }
  return resolved
}

/** Reads only explicitly enabled coordination and rejects a changed transport network. @internal */
export function management(client: Client): RecordManagement | undefined {
  const config = client.recordManagement as RecordManagement | undefined
  if (config?.enabled !== true) return undefined
  if (config.network !== client.transport.config.network) {
    throw new Error('Record management network changed; rebuild the client for the new chain')
  }
  return config
}

/** Reads routing settings independently of whether spending coordination is enabled. @internal */
export function recordSettings(client: Client): Pick<RecordActionsConfig, 'chainId' | 'tokenJoin'> {
  // Client settings take precedence over recordActions options so a decorator
  // cannot change the chain used to look up reservations.
  const settings = client.recordManagement ?? (client as Client & { recordActionConfig?: RecordActionsConfig }).recordActionConfig ?? {}
  if (settings.tokenJoin) validateTokenJoinRouter(settings.tokenJoin)
  return settings
}

/** Derives the reservation namespace from the active chain and account address. @internal */
export function scopeOf(client: Client): string {
  const chain = management(client)?.chainId ?? recordSettings(client).chainId ?? client.transport.config.network
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
 * @param client Client with enabled recordManagement; returns an empty set when disabled or omitted.
 * @returns Nonces excluded from selection. Reads the configured journal.
 * @example
 * const excluded = await reservedRecordIds(client)
 */
export async function reservedRecordIds(client: Client): Promise<Set<string>> {
  const config = management(client)
  if (!config) return new Set()
  // Confirmed inputs remain excluded while a scanner still returns stale records.
  return new Set((await config.store.list(scopeOf(client))).filter(holdsRecords).flatMap((entry) => entry.records))
}

/** Enforces positive bounded integers; the default upper bound is 1000. @internal */
export function positiveInteger(value: number, name: string, max = 1000): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer from 1 to ${max}`)
}
