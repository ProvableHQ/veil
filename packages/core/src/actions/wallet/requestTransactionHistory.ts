import type { Client } from '../../clients/createClient.js'

export type RequestTransactionHistoryParameters = {
  program: string
}

export type RequestTransactionHistoryReturnType = unknown

export async function requestTransactionHistory(
  client: Client,
  params: RequestTransactionHistoryParameters,
): Promise<RequestTransactionHistoryReturnType> {
  return client.request({
    method: 'requestTransactionHistory',
    params: { program: params.program },
  })
}
