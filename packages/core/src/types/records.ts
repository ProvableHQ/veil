export type RecordSearchParams = {
  programId: string
  account?: { viewKey: string } | undefined
  unspent?: boolean | undefined
}

export type AleoRecord = {
  owner: string
  data: Record<string, unknown>
  nonce: string
  programId: string
  plaintext: string
}

/** Records config — either a config object or a custom implementation */
export type RecordsConfig =
  | { mode: 'network'; url: string }
  | { mode: 'local' }
  | { getRecords: (params: RecordSearchParams) => Promise<AleoRecord[]> }
