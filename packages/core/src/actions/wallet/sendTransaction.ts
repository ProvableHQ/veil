import type { Client } from '../../clients/createClient.js'

export type SendTransactionParameters = {
  transaction: string
}

export type SendTransactionReturnType = string

export async function sendTransaction(
  client: Client,
  params: SendTransactionParameters,
): Promise<SendTransactionReturnType> {
  return client.request({
    method: 'sendTransaction',
    params: { transaction: params.transaction },
  }) as Promise<string>
}
