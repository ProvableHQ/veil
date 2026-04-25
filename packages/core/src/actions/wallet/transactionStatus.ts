import type { Client } from '../../clients/createClient.js'
import type { TransactionStatusResponse } from '../../types/wallet.js'

export type TransactionStatusParameters = {
  transactionId: string
}

export type TransactionStatusReturnType = TransactionStatusResponse

export async function transactionStatus(
  client: Client,
  params: TransactionStatusParameters,
): Promise<TransactionStatusReturnType> {
  return client.request({
    method: 'transactionStatus',
    params: { transactionId: params.transactionId },
  }) as Promise<TransactionStatusReturnType>
}
