import { TransactionHistoryNotSupportedError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'
import type { TxHistoryResult } from '../../types/wallet.js'

/**
 * Parameters for `walletClient.requestTransactionHistory`.
 *
 * @property program Program whose transactions to list, e.g. `credits.aleo`.
 */
export type RequestTransactionHistoryParameters = {
  program: string
}

/** The wallet's recorded transactions for the program. */
export type RequestTransactionHistoryReturnType = TxHistoryResult

/**
 * Returns the connected wallet's transaction history for a program.
 *
 * Only supported for RPC accounts (the wallet adapter keeps per-program
 * history). For local accounts there is no equivalent — neither the Aleo
 * network REST API nor the SDK exposes such an endpoint. Throws
 * `TransactionHistoryNotSupportedError` in that case.
 *
 * @param client Wallet client with an RPC (wallet adapter) account.
 * @param params The program to list history for.
 * @returns The wallet's transactions involving the program.
 * @throws TransactionHistoryNotSupportedError if the account is not an RPC account.
 *
 * @example
 * const { transactions } = await walletClient.requestTransactionHistory({
 *   program: 'credits.aleo',
 * })
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
