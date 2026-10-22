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
 * Binds account-dependent record methods without changing spending configuration.
 * Shared by walletActions and the optional compatibility decorator.
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
 * Adds record methods to a custom client without enabling reservation or recovery.
 * Wallet clients already expose these methods. Configure recordManagement with
 * enabled: true at client construction to coordinate ordinary writes and execute
 * inventory plans. Legacy store and maxFeeMicrocredits options here are unused.
 * @param config Optional chain identity and token join router for record actions.
 *   Omission uses the transport network and native joins. Constructor settings take precedence.
 * @returns An extend decorator; construction performs no network calls and allocates no journal.
 * @throws When the optional token join router is invalid.
 * @example
 * const client = walletClient.extend(recordActions({ tokenJoin: { program: 'test_aj_arc20_2_15.aleo' } }))
 */
export function recordActions(config: RecordActionsConfig = {}) {
  // Keep only action-routing options: exposing methods must never opt into writes.
  const recordActionConfig = { chainId: config.chainId, tokenJoin: config.tokenJoin && { ...config.tokenJoin } }
  if (recordActionConfig.tokenJoin) validateTokenJoinRouter(recordActionConfig.tokenJoin)
  return (client: Client) => {
    const scoped = Object.assign(Object.create(client), { recordActionConfig }) as Client
    return { recordActionConfig, ...recordActionMethods(scoped) }
  }
}
