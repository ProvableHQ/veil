/**
 * Raw record data (encrypted, without plaintext)
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
}

/**
 * Record data with decrypted plaintext
 */
export interface OwnedRecord extends OwnedRecordEncrypted {
  recordPlaintext: string
}

export type RecordStatusFilter = 'all' | 'spent' | 'unspent'

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
}

/**
 * A standalone record scanner that has its own view key.
 * Used outside of a wallet client (e.g. view-only dashboards, auditing).
 * NOT pluggable into a wallet client — use createRemoteScanner for that.
 */
export type StandaloneRecordScanner = {
  requestRecords: (params: RequestRecordsParameters) => Promise<OwnedRecord[]>
}
