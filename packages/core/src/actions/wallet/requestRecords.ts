import { AccountNotFoundError } from '../../errors/errors.js'
import type { OwnedRecord, OwnedRecordEncrypted, RecordProvider, RequestRecordsParameters } from '../../types/records.js'
import type { Client } from '../../clients/createClient.js'

export type { RequestRecordsParameters } from '../../types/records.js'

/**
 * Records owned by the account — with plaintext when `includePlaintext` is
 * true (the default), ciphertext-only otherwise.
 */
export type RequestRecordsReturnType = OwnedRecord[] | OwnedRecordEncrypted[]

/**
 * Fetches the account's records for a program.
 *
 * Use it to find spendable records — private balances, program-issued
 * assets — before passing one as a function input. Hits the network: RPC
 * accounts delegate to the wallet adapter (which may prompt the user), local
 * accounts scan via the client's configured `recordProvider` (e.g.
 * `createRemoteScanner()`). Filter with `statusFilter: 'unspent'` to get only
 * records that can still be spent; the default is `'all'`.
 *
 * @param client Wallet client with an account attached.
 * @param params Program to scan, plaintext toggle, and spent-status filter.
 * @returns The matching records; an empty array when the account owns none.
 * @throws AccountNotFoundError if the client has no account.
 * @throws If the account is local and the client was created without a `recordProvider`.
 *
 * @example
 * const records = await walletClient.requestRecords({
 *   program: 'credits.aleo',
 *   statusFilter: 'unspent',
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
    // RPC wallet — always delegate to the wallet adapter transport
    return client.request({
      method: 'requestRecords',
      params: {
        program: params.program,
        includePlaintext: params.includePlaintext ?? true,
        statusFilter: params.statusFilter ?? 'all',
      },
    }) as Promise<RequestRecordsReturnType>
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
