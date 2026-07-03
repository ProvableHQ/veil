import type { Client } from '../../clients/createClient.js'
import type { ConfirmedTransaction } from '../../types/block.js'
import type { TransactionStatusResponse } from '../../types/wallet.js'

/**
 * Parameters for `walletClient.transactionStatus`.
 *
 * @property transactionId On-chain transaction id (`at1...`) to look up.
 */
export type TransactionStatusParameters = {
  transactionId: string
}

/** The transaction's current status and id. */
export type TransactionStatusReturnType = TransactionStatusResponse

/**
 * Returns the status of a submitted transaction.
 *
 * - **RPC accounts**: forwards to the wallet adapter (which queries its
 *   indexer).
 * - **Local accounts (or no account)**: derives status from the network's
 *   REST API.
 *
 * Possible statuses:
 * - `'accepted'`  — present in `/transaction/confirmed/{id}` with `status: 'accepted'`
 * - `'rejected'`  — present in `/transaction/confirmed/{id}` with `status: 'rejected'`
 * - `'pending'`   — present in `/transaction/unconfirmed/{id}`
 * - `'not_found'` — present in neither pool (never submitted, dropped, or expired)
 *
 * Read-only; hits the wallet indexer or the network REST API, never signs.
 *
 * @param client Client whose transport reaches a wallet adapter or an Aleo node.
 * @param params The transaction id to look up.
 * @returns The current status; `'not_found'` rather than a throw when the id is unknown.
 *
 * @example
 * const { status } = await walletClient.transactionStatus({ transactionId: 'at1...' })
 * // status: 'accepted' | 'rejected' | 'pending' | 'not_found'
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
  // A "confirmed" transaction can still be rejected — the envelope carries
  // its own `status: 'accepted' | 'rejected'`, which we surface verbatim.
  try {
    const confirmed = await client.request({
      method: 'getConfirmedTransaction',
      params: { id: params.transactionId },
    }) as ConfirmedTransaction
    return { status: confirmed.status, transactionId: params.transactionId }
  } catch {
    // Not in the confirmed pool — fall through to unconfirmed.
  }

  try {
    await client.request({
      method: 'getUnconfirmedTransaction',
      params: { id: params.transactionId },
    })
    return { status: 'pending', transactionId: params.transactionId }
  } catch {
    return { status: 'not_found', transactionId: params.transactionId }
  }
}
