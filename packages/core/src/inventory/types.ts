import type { OwnedRecordEncrypted } from '../types/records.js'
import type { Transaction } from '../types/transaction.js'

/**
 * Selects the program and fungible record balance to manage.
 * @property program Deployed program id. This is the only required field.
 * @property standard Optional interface hint, verified against deployed code.
 * @property recordName Optional record name. Defaults to credits for credits.aleo,
 *   Token for ARC tokens, or the record accepted by the program's join function.
 * @property amountField Optional balance field. Defaults to amount, then microcredits;
 *   credits.aleo uses microcredits. An override must exist in the selected record.
 * @example
 * const asset: RecordAsset = { program: 'credits.aleo' }
 * const custom: RecordAsset = { program: 'points.aleo', recordName: 'Balance', amountField: 'points' }
 */
export type RecordAsset = {
  program: string
  standard?: 'credits' | 'arc20' | 'arc22'
  recordName?: string
  amountField?: string
}

/**
 * Captures the record fields and integer width resolved from a program.
 * @property recordName Record selected for scans and wallet input requests.
 * @property amountField Field used to read balances and plan outputs.
 * @property amountType Unsigned integer type declared for the amount field.
 */
export type ResolvedRecordAsset = RecordAsset & {
  recordName: string
  amountField: string
  amountType: 'u8' | 'u16' | 'u32' | 'u64' | 'u128'
}

/**
 * Configures a dynamic token join router with join_2 through join_15 functions.
 * @property program Deployed router program id on the client's chain.
 * @property maxRecords Maximum inputs per transaction, from 2 to 15. Defaults to 15.
 * @example
 * const router: TokenJoinRouter = { program: 'main_aj_arc20_2_15.aleo' }
 */
export type TokenJoinRouter = { program: string; maxRecords?: number }

/**
 * Describes a helper that joins several records in one transaction.
 * @property program Helper program id on the selected network.
 * @property inputMode Whether inputs are records alone or a program identifier followed by records.
 * @property counts Supported input counts, from 2 through 16 (at most 15 for dynamic ARC helpers).
 */
export type RecordJoinProgram = {
  program: string
  inputMode: 'records' | 'programIdentifierThenRecords'
  counts: readonly number[]
}

/**
 * Describes a spendable record without requiring plaintext from a wallet.
 * @property id Record nonce, stable across scanners and wallet connections.
 * @property amount Integer base units, bounded by the declared field width: u64 for credits, u128 for ARC tokens.
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
 * @property inputs Input nonces or previous step output references; joins consume two records natively, up to 16 with static helpers, or 15 with dynamic ARC helpers.
 * @property outputs Predicted output references and amounts; never spendable until confirmed.
 * @property amount Split's first output amount; absent for joins.
 * @property deduction Intrinsic credits deduction, separate from transaction fees.
 * @property joinProgram Helper captured for this join; omission uses the native join or plan.tokenJoin.
 */
export type InventoryStep = {
  kind: 'join' | 'split'
  joinProgram?: RecordJoinProgram
  inputs: string[]
  outputs: { id: string; amount: bigint }[]
  amount?: bigint
  deduction: bigint
}

/**
 * Captures a read-only inventory plan bound to an account and chain.
 * @property scope Chain/account reservation namespace.
 * @property asset Program with its resolved record name, amount field, and integer width.
 * @property target Requested record count, minimum amount, and distribution.
 * @property inputs Eligible snapshot, containing no plaintext.
 * @property steps Ordered dependencies with predicted base-unit amounts.
 * @property deduction Total intrinsic credits deduction; network fees are additional.
 * @property maxTransactions Maximum operations allowed; defaults to 100.
 * @property tokenJoin Optional explicitly configured dynamic token router.
 * @property joinPrograms Available helper ABIs captured when planning; omission uses native pairwise joins.
 */
export type InventoryPlan = {
  scope: string
  asset: RecordAsset & Partial<Pick<ResolvedRecordAsset, 'amountType'>>
  target: InventoryTarget
  inputs: { id: string; amount: bigint }[]
  steps: InventoryStep[]
  deduction: bigint
  maxTransactions: number
  tokenJoin?: TokenJoinRouter
  joinPrograms?: RecordJoinProgram[]
}

/** Tracks reservation and transaction recovery states. */
export type RecordSpendStatus = 'reserved' | 'prepared' | 'submitted' | 'confirmed' | 'rejected' | 'cancelled'

/**
 * Stores an operation's durable checkpoint, without record plaintext or keys.
 * @property id Store-assigned identifier, unique within the store.
 * @property scope Chain/account namespace.
 * @property records Reserved record nonces, including the private fee record when present.
 * @property feeRecordId Optional private fee record nonce; remains spent even when execution is rejected.
 * @property program Target transaction program.
 * @property function Transition name.
 * @property assetProgram Underlying token program for a routed join; absent for native operations.
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
  feeRecordId?: string
  program: string
  function: string
  assetProgram?: string
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
 * Rejected executions release their inputs except feeRecordId, whose fee was charged.
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
 * Configures record action routing without enabling spending coordination.
 * @property chainId Optional chain identity for plans. Defaults to the transport network.
 * @property tokenJoin Optional dynamic ARC router override. Omission selects available helpers by asset and network; false disables all helpers.
 * @property store Accepted but ignored by recordActions. Set recordManagement.store
 *   with enabled: true on the client to share a journal.
 * @property maxFeeMicrocredits Accepted but ignored by recordActions. Set
 *   recordManagement.maxFeeMicrocredits with enabled: true on the client to limit fees.
 */
export type RecordActionsConfig = {
  store?: RecordInventoryStore
  chainId?: string
  maxFeeMicrocredits?: bigint
  tokenJoin?: TokenJoinRouter | false
}

/**
 * Configures shared record reservations and transaction recovery on a client.
 * Set enabled to true to prevent participating clients from spending the same
 * record and to track unfinished transactions. Disabled settings can still
 * supply a chain identity and token router for calls to record actions.
 * Adding record methods alone creates no journal and leaves writes unchanged.
 * @property enabled Enables reservations and recovery. Omitting recordManagement
 *   from the client configuration leaves both disabled.
 * @property store Journal shared by participating clients. Defaults to one
 *   in-memory store per enabled client; unused when disabled.
 * @property chainId Stable chain identity shared by participants. Defaults to the transport network;
 *   custom/local chains MUST supply a distinct identity.
 * @property maxFeeMicrocredits Maximum fee in microcredits (u64), checked on the
 *   proved transaction before broadcast. Defaults to no limit; ignored when disabled.
 * @property tokenJoin Optional dynamic ARC router override. Omission selects available helpers by asset and network; false uses native pairwise joins for all assets.
 * @example
 * const recordManagement: RecordManagementConfig = {
 *   enabled: true, store: memoryRecordInventoryStore(), chainId: 'aleo:testnet',
 * }
 */
export type RecordManagementConfig = RecordActionsConfig & { enabled: boolean }

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
