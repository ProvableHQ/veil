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

/**
 * Parameters for requestRecords — scopes and narrows a record scan.
 *
 * `program` is the common case and covers most calls on its own. `filter`
 * narrows further, and a scan served by the Record Scanning Service pushes
 * those bounds to the service so a slimmer result set travels the wire.
 *
 * @property program Program whose records to scan, e.g. `'credits.aleo'`.
 *   Optional: omitting it scans every program the account holds records for,
 *   which suits a wallet-wide sweep. REQUIRED for an RPC (wallet) account —
 *   the wallet-adapter protocol scopes a record request to one program and has
 *   no all-programs form, so omitting it there throws. Unioned with
 *   `filter.programs` when both are set.
 * @property includePlaintext Whether to include decrypted plaintext on each
 *   record. Defaults to true. Set false for a ciphertext-only scan, which skips
 *   local decryption.
 * @property statusFilter Whether to return spent records, unspent records, or
 *   both. Defaults to `'all'`.
 * @property filter Row-level narrowing and pagination. Omit to return every
 *   record in scope.
 */
export type RequestRecordsParameters = {
  program?: string
  includePlaintext?: boolean
  statusFilter?: RecordStatusFilter
  filter?: RecordFilter
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
 * Narrows a record scan by commitment, block range, program, record type, or
 * function, with pagination.
 *
 * Every field is an independent AND: setting `records` and `functions` returns
 * only records matching both. Within one field the values are an OR — `records:
 * ['Position', 'Fee']` returns either type. An omitted field applies no bound,
 * and neither does an empty array: `commitments: []` is treated as absent rather
 * than as a list nothing can match, so a list built at runtime that comes back
 * empty widens the scan instead of silently emptying it.
 *
 * Where the bounds are applied depends on the account. A local account scanning
 * through a `RecordProvider` pushes them to the record scanning backend, which
 * filters and pages before responding, so less travels the wire. An RPC (wallet)
 * account cannot forward them — the wallet-adapter protocol carries only
 * program, plaintext, and spent status — so Veil applies them to what the wallet
 * returned.
 *
 * The two paths agree on which records match, with one exception a caller MUST
 * account for: a bound can only be evaluated against a field the record carries.
 * A privacy-preserving wallet omits fields withheld under a `recordAccess`
 * grant, and a bound on a withheld field therefore matches nothing rather than
 * being ignored — filtering on `records` against a connection that does not
 * grant `recordName` returns an empty result. Filter on granted fields.
 *
 * `program` is exempt, and is the dependable way to scope a wallet scan: it
 * travels as a request parameter rather than being matched against a returned
 * field, so no grant and no difference in how the wallet spells a program id can
 * turn it into an empty result.
 *
 * @property commitments Commitments to return, each an Aleo `field` literal.
 *   Suited to re-reading known records. A malformed literal fails the request.
 * @property start Lower bound of the block-height range, inclusive.
 * @property end Upper bound of the block-height range, inclusive.
 * @property programs Program ids to include, e.g. `['credits.aleo']`. Unioned
 *   with `RequestRecordsParameters.program` when both are set.
 * @property records Record type names to include, e.g. `['Position']`. These
 *   are the record's declared name in the program, not the program id.
 * @property functions Names of the functions that produced the records.
 * @property resultsPerPage Records per page. Defaults to 1000, which is also the
 *   ceiling: a larger value is clamped down rather than rejected, so a scan
 *   matching more records than one page holds MUST page to read them all. MUST be
 *   a positive integer; anything else throws rather than returning a surprising
 *   slice.
 * @property page Zero-based page index. Defaults to 0. MUST be a non-negative
 *   integer; anything else throws.
 * @property response Field-selection mask. Applies to no current path and
 *   narrows nothing: the Record Scanning Service selects columns from a separate
 *   top-level field that no client sends, so every column returns regardless.
 *   Retained because it ships in a released type; do not reach for it.
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
