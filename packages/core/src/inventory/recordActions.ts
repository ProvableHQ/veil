import type { Client } from '../clients/createClient.js'
import type { RecordActionsConfig } from './types.js'
import { getRecordInventory, type GetRecordInventoryParameters } from '../actions/records/getRecordInventory.js'
import { planRecordInventory, type PlanRecordInventoryParameters } from '../actions/records/planRecordInventory.js'
import { rebalanceRecordInventory, type RebalanceRecordInventoryParameters } from '../actions/records/rebalanceRecordInventory.js'
import { reconcileRecordInventory, type ReconcileRecordInventoryParameters } from '../actions/records/reconcileRecordInventory.js'
import { joinRecords, type JoinRecordsParameters } from '../actions/records/joinRecords.js'
import { splitRecord, type SplitRecordParameters } from '../actions/records/splitRecord.js'
import { autoJoin, type AutoJoinParameters } from '../actions/records/autoJoin.js'
import { validateTokenJoinRouter } from './tokenJoin.js'

/**
 * Binds record methods to an account client without changing its spending settings.
 * Used by walletActions and recordActions.
 * @internal
 */
export function recordActionMethods(client: Client) {
  return {
    getRecordInventory: (params: GetRecordInventoryParameters) => getRecordInventory(client, params),
    planRecordInventory: (params: PlanRecordInventoryParameters) => planRecordInventory(client, params),
    rebalanceRecordInventory: (params: RebalanceRecordInventoryParameters) => rebalanceRecordInventory(client, params),
    reconcileRecordInventory: (params?: ReconcileRecordInventoryParameters) => reconcileRecordInventory(client, params),
    joinRecords: (params: JoinRecordsParameters) => joinRecords(client, params),
    splitRecord: (params: SplitRecordParameters) => splitRecord(client, params),
    autoJoin: (params: AutoJoinParameters) => autoJoin(client, params),
  }
}

/**
 * Adds inventory methods to a custom client.
 * Wallet clients already include these methods. This decorator leaves reservations
 * and recovery disabled unless the client was created with recordManagement
 * enabled: true. Its store and maxFeeMicrocredits options are ignored; supply
 * them in the client's recordManagement configuration to reserve records during
 * writes and execute inventory plans.
 * @param config Optional chain identity and token join router. Defaults to the
 *   transport network and native joins. The client's recordManagement settings
 *   take precedence when present.
 * @returns A decorator for client.extend(). Creates no journal and makes no network requests.
 * @throws When the optional token join router is invalid.
 * @example
 * const client = walletClient.extend(recordActions({ tokenJoin: { program: 'test_aj_arc20_2_15.aleo' } }))
 */
export function recordActions(config: RecordActionsConfig = {}) {
  // Keep chain and router settings here; the client configuration controls reservations.
  const recordActionConfig = { chainId: config.chainId, tokenJoin: config.tokenJoin && { ...config.tokenJoin } }
  if (recordActionConfig.tokenJoin) validateTokenJoinRouter(recordActionConfig.tokenJoin)
  return (client: Client) => {
    const scoped = Object.assign(Object.create(client), { recordActionConfig }) as Client
    return { recordActionConfig, ...recordActionMethods(scoped) }
  }
}
