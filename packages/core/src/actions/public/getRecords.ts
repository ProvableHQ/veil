import type { Client } from '../../clients/createClient.js'
import type { AleoRecord } from '../../types/records.js'

export type GetRecordsParameters = { programId: string }
export type GetRecordsReturnType = AleoRecord[]

export async function getRecords(client: Client, params: GetRecordsParameters): Promise<GetRecordsReturnType> {
  // If records config provides a custom getRecords implementation, use it
  if (client.records && 'getRecords' in client.records) {
    return client.records.getRecords({ programId: params.programId })
  }

  // If records config is network mode, delegate to the transport
  if (client.records && 'mode' in client.records && client.records.mode === 'network') {
    return client.request({
      method: 'getRecords',
      params: { programId: params.programId },
    }) as Promise<AleoRecord[]>
  }

  // No records config — delegate to transport (works for wallet adapter transports
  // that support requestRecords)
  try {
    return await (client.request({
      method: 'requestRecords',
      params: { programId: params.programId },
    }) as Promise<AleoRecord[]>)
  } catch {
    // Transport doesn't support record fetching — return empty
    return []
  }
}
