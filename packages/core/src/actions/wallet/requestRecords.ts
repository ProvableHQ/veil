import { AccountNotFoundError } from '../../errors/errors.js'
import type { AleoRecord } from '../../types/records.js'
import type { Client } from '../../clients/createClient.js'

export type RequestRecordsParameters = {
  program: string
}

export type RequestRecordsReturnType = AleoRecord[]

export async function requestRecords(
  client: Client,
  params: RequestRecordsParameters,
): Promise<RequestRecordsReturnType> {
  if (!client.account) {
    throw new AccountNotFoundError()
  }

  return client.request({
    method: 'requestRecords',
    params: { program: params.program },
  }) as Promise<AleoRecord[]>
}
