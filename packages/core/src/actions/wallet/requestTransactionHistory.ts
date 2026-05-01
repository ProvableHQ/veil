import { TransactionHistoryNotSupportedError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'
import type { TxHistoryResult } from '../../types/wallet.js'

export type RequestTransactionHistoryParameters = {
  program: string
}

export type RequestTransactionHistoryReturnType = TxHistoryResult

/**
 * Returns the connected wallet's transaction history for a program.
 *
 * Only supported for RPC accounts (the wallet adapter keeps per-program
 * history). For local accounts there is no equivalent — neither the Aleo
 * network REST API nor the SDK exposes such an endpoint. Throws
 * `TransactionHistoryNotSupportedError` in that case.
 */
export async function requestTransactionHistory(
  client: Client,
  params: RequestTransactionHistoryParameters,
): Promise<RequestTransactionHistoryReturnType> {
  if (client.account?.type !== 'rpc') {
    throw new TransactionHistoryNotSupportedError()
  }
  return client.request({
    method: 'requestTransactionHistory',
    params: { program: params.program },
  }) as Promise<RequestTransactionHistoryReturnType>
}
