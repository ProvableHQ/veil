import type { Client } from '../clients/createClient.js'
import type { RecordActionsConfig } from './types.js'
import type { RecordManagement } from './internal.js'
import { memoryRecordInventoryStore } from './store.js'
import { getRecordInventory, type GetRecordInventoryParameters } from '../actions/records/getRecordInventory.js'
import { planRecordInventory, type PlanRecordInventoryParameters } from '../actions/records/planRecordInventory.js'
import { rebalanceRecordInventory, type RebalanceRecordInventoryParameters } from '../actions/records/rebalanceRecordInventory.js'
import { reconcileRecordInventory, type ReconcileRecordInventoryParameters } from '../actions/records/reconcileRecordInventory.js'
import { joinRecords, type JoinRecordsParameters } from '../actions/records/joinRecords.js'
import { splitRecord, type SplitRecordParameters } from '../actions/records/splitRecord.js'
import { autoJoin, type AutoJoinParameters } from '../actions/records/autoJoin.js'
import { writeContract, type WriteContractParameters } from '../actions/wallet/writeContract.js'
import { executeContract, type ExecuteContractParameters } from '../actions/wallet/executeContract.js'
import { validateTokenJoinRouter } from './tokenJoin.js'

/**
 * Adds record inventory actions and shared spending coordination to an account client.
 * Configuration is opt-in; apply before protocol decorators such as shieldSwapActions.
 * @param config Shared store, chain identity, and optional per-transaction fee limit.
 * @returns An extend decorator; construction performs no network calls.
 * @throws When chain identity is absent or the fee limit is negative.
 * @example
 * const client = walletClient.extend(recordActions({ store, chainId: 'aleo:testnet' }))
 */
export function recordActions(config: RecordActionsConfig = {}) {
  const store = config.store ?? memoryRecordInventoryStore()
  return (client: Client) => {
    const chainId = config.chainId ?? client.transport.config.network
    if (!chainId) throw new Error('recordActions requires chainId on a transport without a network')
    if (config.maxFeeMicrocredits !== undefined && config.maxFeeMicrocredits < 0n) throw new Error('Fee limit cannot be negative')
    const tokenJoin = config.tokenJoin && { ...config.tokenJoin }
    if (tokenJoin) validateTokenJoinRouter(tokenJoin)
    const recordManagement: RecordManagement = { store, chainId, network: client.transport.config.network, maxFeeMicrocredits: config.maxFeeMicrocredits, tokenJoin }
    const scoped = Object.assign(Object.create(client), { recordManagement }) as Client
    return {
      recordManagement,
      getRecordInventory: (params: GetRecordInventoryParameters) => getRecordInventory(scoped, params),
      planRecordInventory: (params: PlanRecordInventoryParameters) => planRecordInventory(scoped, params),
      rebalanceRecordInventory: (params: RebalanceRecordInventoryParameters) => rebalanceRecordInventory(scoped, params),
      reconcileRecordInventory: (params?: ReconcileRecordInventoryParameters) => reconcileRecordInventory(scoped, params),
      joinRecords: (params: JoinRecordsParameters) => joinRecords(scoped, params),
      splitRecord: (params: SplitRecordParameters) => splitRecord(scoped, params),
      autoJoin: (params: AutoJoinParameters) => autoJoin(scoped, params),
      writeContract: (params: WriteContractParameters) => writeContract(scoped, params),
      executeTransaction: (params: WriteContractParameters) => writeContract(scoped, params),
      executeContract: (params: ExecuteContractParameters) => executeContract(scoped, params),
    }
  }
}
