import type { Client } from '../../clients/createClient.js'

export type TransactionStatusParameters = {
  transactionId: string
}

export type TransactionStatusReturnType = unknown

export async function transactionStatus(
  client: Client,
  params: TransactionStatusParameters,
): Promise<TransactionStatusReturnType> {
  return client.request({
    method: 'transactionStatus',
    params: { transactionId: params.transactionId },
  })
}
