import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for `walletClient.sendTransaction`.
 *
 * @property transaction Fully built transaction as a JSON string — already proved and fee-paid, ready for the network verbatim.
 */
export type SendTransactionParameters = {
  transaction: string
}

/** Transaction id (`at1...`) assigned by the network on broadcast. */
export type SendTransactionReturnType = string

/**
 * Broadcasts an already-built transaction to the network.
 *
 * Applies when the transaction was proved elsewhere — a delegated
 * prover, an offline build — and only needs submitting. Does not sign or
 * prove; higher-level actions (`writeContract`, `deployContract`) build the
 * transaction and call this internally. Hits the network and returns as soon
 * as the node accepts the broadcast — it does not wait for the transaction to
 * be accepted into a block. Poll `transactionStatus` for that.
 *
 * @param client Client whose transport reaches an Aleo node.
 * @param params The serialized transaction to submit.
 * @returns The transaction id to poll with `transactionStatus`.
 * @throws If the node rejects the broadcast (e.g. malformed transaction or invalid proof).
 *
 * @example
 * const txId = await walletClient.sendTransaction({ transaction: JSON.stringify(tx) })
 */
export async function sendTransaction(
  client: Client,
  params: SendTransactionParameters,
): Promise<SendTransactionReturnType> {
  return client.request({
    method: 'sendTransaction',
    params: { transaction: params.transaction },
  }) as Promise<string>
}
