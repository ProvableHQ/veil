import type { Network } from './wallet.js'

/**
 * The granted, decrypted view of a record's contents.
 *
 * Populated by a privacy-preserving wallet with only the fields the connection's
 * recordAccess grant permits; ungranted fields are omitted. Values are
 * Aleo-encoded strings.
 *
 * @property fields Granted field key → Aleo-encoded value string. Keys may be a
 *   record-body field name, a dotted struct path ("data.amount"), or a
 *   `$`-prefixed metadata token ("$commitment").
 */
export interface RecordView {
  fields: Record<string, string>
}

/**
 * Raw record data (encrypted, without plaintext).
 *
 * @property uid Opaque per-connection handle from a privacy-preserving wallet;
 *   pass back as a record InputRequest `uid` to spend exactly this record.
 *   Absent from wallets that predate the privacy feature.
 * @property recordView Granted plaintext fields when the wallet withholds full
 *   plaintext under a recordAccess grant. Absent when no field access was granted.
 */
export interface OwnedRecordEncrypted {
  blockHeight?: number
  blockTimestamp?: number
  commitment?: string
  functionName?: string
  outputIndex?: number
  owner?: string
  programName: string
  recordCiphertext?: string
  recordName?: string
  sender?: string
  spent?: boolean
  tag: string
  transactionId?: string
  transitionId?: string
  transactionIndex?: number
  transitionIndex?: number
  uid?: string
  recordView?: RecordView
}

/**
 * Record data with decrypted plaintext
 */
export interface OwnedRecord extends OwnedRecordEncrypted {
  recordPlaintext: string
}

/** Spent-status filter for a record request. */
export type RecordStatusFilter = 'all' | 'spent' | 'unspent'

/** Parameters for requestRecords — scopes the scan to one program's records. */
export type RequestRecordsParameters = {
  program: string
  /** Whether to include plaintext on each record. Defaults to true. */
  includePlaintext?: boolean
  /** Filter records by spent status. Defaults to 'all'. */
  statusFilter?: RecordStatusFilter
}

// ---------------------------------------------------------------------------
// RSS (Record Scanning Service) types
// ---------------------------------------------------------------------------

/** Field-selection mask for RSS responses — set a field true to include it on each returned record. */
export type ResponseFilter = {
  blockHeight?: boolean
  checksum?: boolean
  commitment?: boolean
  recordCiphertext?: boolean
  functionName?: boolean
  nonce?: boolean
  outputIndex?: boolean
  owner?: boolean
  programName?: boolean
  recordName?: boolean
  transactionId?: boolean
  transitionId?: boolean
  transactionIndex?: boolean
  transitionIndex?: boolean
}

/**
 * Narrows an RSS scan by commitments, block range, programs, record types,
 * or functions, with pagination.
 *
 * @property start Lower bound of the block-height range to scan.
 * @property end Upper bound of the block-height range to scan.
 * @property records Record type names to include.
 * @property functions Names of the functions that produced the records.
 * @property response Field-selection mask applied to each returned record.
 */
export type RecordFilter = {
  commitments?: string[]
  start?: number
  end?: number
  programs?: string[]
  records?: string[]
  functions?: string[]
  resultsPerPage?: number
  page?: number
  response?: ResponseFilter
}

/**
 * Request body for an RSS owned-records query.
 *
 * @property uuid Scan session identifier issued by the service.
 * @property unspent When true, return only unspent records.
 */
export type OwnedRecordsRequest = {
  uuid: string
  unspent?: boolean
  filter?: RecordFilter
}

// ---------------------------------------------------------------------------
// Record provider interface — used by LocalWalletClient for record scanning
// ---------------------------------------------------------------------------

/**
 * A record provider that can fetch records for a local account.
 *
 * Used with LocalWalletClientConfig only — RPC wallets handle records
 * through the wallet adapter transport.
 *
 * The provider manages the active account internally. Call setAccount()
 * when the active account changes (e.g. switch account).
 */
export type RecordProvider = {
  requestRecords: (params: RequestRecordsParameters) => Promise<OwnedRecord[]>
  /** Update the active account for record scanning */
  setAccount: (account: { viewKey: string }) => void
  /**
   * Re-targets record scanning to another network. Optional — the
   * `switchChain` action calls it when present, so a provider that
   * implements it keeps `requestRecords` consistent with the client's
   * network after a chain switch; a provider without it keeps scanning
   * the network it was created for. May hit the network (re-registration
   * on the new chain happens lazily on the next scan).
   *
   * @param network Network to scan from then on, e.g. `'mainnet'`.
   * @throws If the provider cannot serve the requested network; the
   *   `switchChain` action then restores the client's previous network.
   */
  switchNetwork?: (network: Network) => void | Promise<void>
}

/**
 * A standalone record scanner that has its own view key.
 * Used outside of a wallet client (e.g. view-only dashboards, auditing).
 * NOT pluggable into a wallet client — use createRemoteScanner for that.
 */
export type StandaloneRecordScanner = {
  requestRecords: (params: RequestRecordsParameters) => Promise<OwnedRecord[]>
}
