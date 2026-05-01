import type { Client } from '../clients/createClient.js'
import type { StandaloneRecordScanner, RequestRecordsParameters, OwnedRecord } from '../types/records.js'

/**
 * Extends any client with record scanning via a standalone scanner.
 *
 * Use this for view-only record access (e.g. dashboards, auditing)
 * without a full wallet client.
 *
 * ```ts
 * const client = createPublicClient({ transport })
 *   .extend(withRecords({
 *     scanner: createStandaloneScanner({ url, viewKey }),
 *   }))
 *
 * const records = await client.requestRecords({ program: 'token.aleo' })
 * ```
 */
export function withRecords(config: { scanner: StandaloneRecordScanner }) {
  return (_client: Client) => ({
    requestRecords: (params: RequestRecordsParameters): Promise<OwnedRecord[]> =>
      config.scanner.requestRecords(params),
  })
}
