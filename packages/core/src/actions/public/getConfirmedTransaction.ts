import type { Client } from '../../clients/createClient.js'
import type { ConfirmedTransaction } from '../../types/block.js'

/**
 * Parameters for {@link getConfirmedTransaction}.
 *
 * @property id Transaction id (`at1...`) to fetch from the ledger.
 */
export type GetConfirmedTransactionParameters = { id: string }

/** The confirmed transaction, wrapped with its accepted/rejected status and block index. */
export type GetConfirmedTransactionReturnType = ConfirmedTransaction

/**
 * Retrieves a transaction from the ledger together with its confirmation
 * outcome.
 *
 * Queries the connected Aleo node, so it hits the network. Unlike
 * `getTransaction`, which returns the bare transaction, this wraps it with
 * whether it was accepted or rejected and its index in the block — use it
 * when the outcome matters, e.g. to confirm a transfer landed.
 *
 * @param client Client whose transport serves the query.
 * @param params Transaction to fetch.
 * @returns The transaction with its accepted/rejected status.
 *
 * @example
 * const tx = await client.getConfirmedTransaction({ id: 'at1...' })
 */
export async function getConfirmedTransaction(
  client: Client,
  params: GetConfirmedTransactionParameters,
): Promise<GetConfirmedTransactionReturnType> {
  return client.request({
    method: 'getConfirmedTransaction',
    params: { id: params.id },
  }) as Promise<GetConfirmedTransactionReturnType>
}
