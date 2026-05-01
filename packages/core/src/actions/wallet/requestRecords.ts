import { AccountNotFoundError } from '../../errors/errors.js'
import type { OwnedRecord, OwnedRecordEncrypted, RecordProvider, RequestRecordsParameters } from '../../types/records.js'
import type { Client } from '../../clients/createClient.js'

export type { RequestRecordsParameters } from '../../types/records.js'
export type RequestRecordsReturnType = OwnedRecord[] | OwnedRecordEncrypted[]

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
        'Pass createLocalScanner() or createRemoteScanner() in your wallet client config.',
      )
    }
    return recordProvider.requestRecords(params)
  }

  throw new AccountNotFoundError()
}
