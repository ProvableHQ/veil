import type { OwnedRecordEncrypted } from '../types/records.js'
import type { Transaction } from '../types/transaction.js'

/**
 * Describes the program whose fungible records are managed.
 * @property program Deployed program id; native credits MUST use credits.aleo.
 * @property standard Record and transition shape, verified against deployed code.
 * @example
 * const asset: RecordAsset = { program: 'credits.aleo', standard: 'credits' }
 */
export type RecordAsset = { program: string; standard: 'credits' | 'arc20' | 'arc22' }

/**
 * Describes a spendable record without requiring plaintext from a wallet.
 * @property id Record nonce, stable across scanners and wallet connections.
 * @property amount Integer base units, bounded by u64 for credits or u128 for tokens.
 * @property record Scanner or wallet record; plaintext remains in memory only.
 */
export type InventoryRecord = { id: string; amount: bigint; record: OwnedRecordEncrypted }

/**
 * Defines the desired spendable inventory.
 * @property records Positive target count, at most 1000.
 * @property minRecordAmount Minimum positive output in base units. Defaults to 1n.
 * @property distribution Defaults to preserve; balanced reshapes skewed inventory.
 * @property toleranceBps Allowed deviation from equal amounts, 0–10000. Defaults to 1000 (10%).
 */
export type InventoryTarget = {
  records: number
  minRecordAmount?: bigint
  distribution?: 'preserve' | 'balanced'
  toleranceBps?: number
}

/**
 * Describes one join or split, with references to earlier planned outputs.
 * @property kind Transition to invoke.
 * @property inputs Input nonces or previous step output references.
 * @property outputs Predicted output references and amounts; never spendable until confirmed.
 * @property amount Split's first output amount; absent for joins.
 * @property deduction Intrinsic credits deduction, separate from transaction fees.
 */
export type InventoryStep = {
  kind: 'join' | 'split'
  inputs: string[]
  outputs: { id: string; amount: bigint }[]
  amount?: bigint
  deduction: bigint
}

/**
 * Captures a read-only inventory plan bound to an account and chain.
 * @property scope Chain/account reservation namespace.
 * @property asset Verified token program and standard.
 * @property target Requested inventory shape.
 * @property inputs Eligible snapshot, containing no plaintext.
 * @property steps Ordered dependencies with predicted base-unit amounts.
 * @property deduction Total intrinsic credits deduction; network fees are additional.
 * @property maxTransactions Maximum operations allowed; defaults to 100.
 */
export type InventoryPlan = {
  scope: string
  asset: RecordAsset
  target: InventoryTarget
  inputs: { id: string; amount: bigint }[]
  steps: InventoryStep[]
  deduction: bigint
  maxTransactions: number
}

/** Tracks reservation and transaction recovery states. */
export type RecordSpendStatus = 'reserved' | 'prepared' | 'submitted' | 'confirmed' | 'rejected' | 'cancelled'

/**
 * Stores an operation's durable checkpoint, without record plaintext or keys.
 * @property id Store-assigned identifier, unique within the store.
 * @property scope Chain/account namespace.
 * @property records Reserved record nonces.
 * @property program Target transaction program.
 * @property function Transition name.
 * @property status Last persisted lifecycle boundary.
 * @property createdAt Unix time in milliseconds.
 * @property accountType Distinguishes local prepare-before-broadcast from opaque wallet submission.
 * @property transactionId Known transaction id, retained on ambiguous submission.
 * @property transaction Fully proved transaction retained before broadcast for safe resubmission.
 * @property feeMicrocredits Total network fee in microcredits, as a decimal string.
 */
export type RecordSpend = {
  id: string
  scope: string
  records: string[]
  program: string
  function: string
  status: RecordSpendStatus
  createdAt: number
  accountType: 'local' | 'rpc'
  transactionId?: string
  transaction?: Transaction
  feeMicrocredits?: string
}

/**
 * Coordinates record spending across participating clients.
 * Implementations MUST atomically acquire all inputs or none, and durably finish
 * each mutation before resolving. Confirmed inputs stay excluded from stale scans.
 * @property list Reads the journal for one chain/account namespace.
 * @property acquire Allocates an id and reserves inputs, or returns undefined on contention.
 * @property update Persists a checkpoint for an existing operation.
 * @example
 * const store: RecordInventoryStore = memoryRecordInventoryStore()
 */
export type RecordInventoryStore = {
  list(scope: string): Promise<RecordSpend[]>
  acquire(entry: Omit<RecordSpend, 'id'>): Promise<RecordSpend | undefined>
  update(scope: string, id: string, patch: Partial<Pick<RecordSpend,
    'status' | 'transactionId' | 'transaction' | 'feeMicrocredits'>>): Promise<void>
}

/**
 * Configures opt-in coordination for inventory and ordinary writes.
 * @property store Shared reservation/journal store. Defaults to an in-memory store per decorator.
 * @property chainId Stable chain identity shared by all participants. Defaults to transport network;
 *   custom/local chains MUST supply a distinct identity.
 * @property maxFeeMicrocredits Maximum proved transaction fee, before broadcast. Optional, no limit by default.
 */
export type RecordActionsConfig = {
  store?: RecordInventoryStore
  chainId?: string
  maxFeeMicrocredits?: bigint
}

/**
 * Reports completed operations or a resumable interruption.
 * @property status Whether every planned step finished.
 * @property transactionIds Known prepared/submitted transaction ids, including uncertain submissions.
 * @property completedSteps Operations confirmed with their exact outputs visible in the scanner.
 * @property reason Interruption detail; absent on completion.
 */
export type InventoryResult = {
  status: 'complete' | 'interrupted'
  transactionIds: string[]
  completedSteps: number
  reason?: string
}
