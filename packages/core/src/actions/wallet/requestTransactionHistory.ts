import type { Client } from '../../clients/createClient.js'
import type { TxHistoryResult } from '../../types/wallet.js'

export type RequestTransactionHistoryParameters = {
  program: string
}

export type RequestTransactionHistoryReturnType = TxHistoryResult

export async function requestTransactionHistory(
  client: Client,
  params: RequestTransactionHistoryParameters,
): Promise<RequestTransactionHistoryReturnType> {
  return client.request({
    method: 'requestTransactionHistory',
    params: { program: params.program },
  }) as Promise<RequestTransactionHistoryReturnType>
}
