import type { Client } from '../../clients/createClient.js'
import type { TransactionStatusResponse } from '../../types/wallet.js'

export type TransactionStatusParameters = {
  transactionId: string
}

export type TransactionStatusReturnType = TransactionStatusResponse

/**
 * Returns the status of a submitted transaction.
 *
 * - **RPC accounts**: forwards to the wallet adapter (which queries its
 *   indexer).
 * - **Local accounts (or no account)**: derives status from the network's
 *   REST API. Confirmed → `'finalized'`; unconfirmed → `'pending'`; missing
 *   → `'rejected'`.
 */
export async function transactionStatus(
  client: Client,
  params: TransactionStatusParameters,
): Promise<TransactionStatusReturnType> {
  if (client.account?.type === 'rpc') {
    return client.request({
      method: 'transactionStatus',
      params: { transactionId: params.transactionId },
    }) as Promise<TransactionStatusReturnType>
  }

  // Derive status from the chain. Confirmed transactions live at
  // `/transaction/confirmed/{id}`, unconfirmed at `/transaction/unconfirmed/{id}`.
  try {
    await client.request({
      method: 'getConfirmedTransaction',
      params: { id: params.transactionId },
    })
    return { status: 'finalized', transactionId: params.transactionId }
  } catch {
    // Not yet confirmed — check unconfirmed pool.
  }

  try {
    await client.request({
      method: 'getUnconfirmedTransaction',
      params: { id: params.transactionId },
    })
    return { status: 'pending', transactionId: params.transactionId }
  } catch (err) {
    return {
      status: 'rejected',
      transactionId: params.transactionId,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
