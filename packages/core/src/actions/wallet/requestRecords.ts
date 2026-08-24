import { AccountNotFoundError } from '../../errors/errors.js'
import type { OwnedRecord, OwnedRecordEncrypted, RecordProvider, RequestRecordsParameters } from '../../types/records.js'
import type { Client } from '../../clients/createClient.js'
import { applyRecordFilter } from '../../utils/recordFilter.js'

export type { RequestRecordsParameters } from '../../types/records.js'

/**
 * Records owned by the account — with plaintext when `includePlaintext` is
 * true (the default), ciphertext-only otherwise.
 */
export type RequestRecordsReturnType = OwnedRecord[] | OwnedRecordEncrypted[]

/**
 * Fetches the account's records, optionally narrowed to a program and a filter.
 *
 * Use it to find spendable records — private balances, program-issued
 * assets — before passing one as a function input. Hits the network: RPC
 * accounts delegate to the wallet adapter (which may prompt the user), local
 * accounts scan via the client's configured `recordProvider` (e.g.
 * `createRemoteScanner()`). Filter with `statusFilter: 'unspent'` to get only
 * records that can still be spent; the default is `'all'`.
 *
 * `params.filter` narrows further — by record type, producing function, block
 * range, or commitment — and pages the result. See {@link RecordFilter} for what
 * each bound means and for the one case where a wallet connection changes the
 * outcome.
 *
 * @param client Wallet client with an account attached.
 * @param params Program to scan, plaintext toggle, spent-status filter, and
 *   optional row filter. `program` may be omitted for a local account to scan
 *   every program, but is REQUIRED for an RPC account.
 * @returns The matching records; an empty array when the account owns none.
 * @throws AccountNotFoundError if the client has no account.
 * @throws If the account is RPC and `program` was omitted — the wallet-adapter
 *   protocol has no all-programs record request.
 * @throws If the account is local and the client was created without a `recordProvider`.
 *
 * @example
 * const records = await walletClient.requestRecords({
 *   program: 'credits.aleo',
 *   statusFilter: 'unspent',
 *   filter: { records: ['credits'], resultsPerPage: 50 },
 * })
 */
export async function requestRecords(
  client: Client,
  params: RequestRecordsParameters,
): Promise<RequestRecordsReturnType> {
  if (!client.account) {
    throw new AccountNotFoundError()
  }

  const account = client.account as { type: string; viewKey?: string }
  const recordProvider = (client as unknown as { recordProvider?: RecordProvider }).recordProvider

  if (account.type === 'rpc') {
    // RPC wallet — always delegate to the wallet adapter transport. The
    // protocol scopes a record request to exactly one program, so an omitted
    // program cannot be expressed; fail here rather than sending `undefined`
    // and letting the wallet interpret it.
    if (!params.program) {
      throw new Error(
        'requestRecords requires a program for a wallet (RPC) account — the wallet protocol has no ' +
        'all-programs record request. Pass `program`, or scan with a local account and a recordProvider.',
      )
    }
    const records = (await client.request({
      method: 'requestRecords',
      params: {
        program: params.program,
        includePlaintext: params.includePlaintext ?? true,
        statusFilter: params.statusFilter ?? 'all',
      },
    })) as OwnedRecordEncrypted[]
    // The adapter honored program, plaintext, and spent status; the remaining
    // bounds have no wire representation, so they are applied to the result.
    // `programScoped` keeps the program bound from being re-tested here — the
    // request carried it, so re-testing could only drop records, and would drop
    // every one of them against a wallet that spells the id differently.
    return applyRecordFilter(records, params, { programScoped: true })
  }

  if (account.type === 'local') {
    // Local account — must use recordProvider
    if (!recordProvider) {
      throw new Error(
        'Local account requires a recordProvider for requestRecords. ' +
        'Pass createRemoteScanner() or a custom RecordProvider in your wallet client config.',
      )
    }
    return recordProvider.requestRecords(params)
  }

  throw new AccountNotFoundError()
}
