import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for {@link getTransitionViewKeys}.
 *
 * @property transactionId Transaction ID (`at1…`) whose transition view keys to request.
 */
export type GetTransitionViewKeysParameters = { transactionId: string }

/** Transition view keys, one per transition the wallet can reveal. */
export type GetTransitionViewKeysReturnType = string[]

/**
 * Requests the transition view keys for a transaction's transitions.
 *
 * A transition view key lets its holder decrypt that transition's encrypted
 * inputs and outputs, so reach for this to reveal a private transaction to an
 * auditor or indexer without sharing the account's view key. Served by
 * wallet-backed transports such as `transportFromAdapter` — the plain `http`
 * node transport rejects this method — and the wallet may prompt the user.
 *
 * @param client Client whose transport is backed by a wallet.
 * @param params Transaction whose view keys to request.
 * @returns One view key per transition the wallet agrees to reveal.
 * @throws When the transport does not support the method or the wallet declines.
 *
 * @example
 * const viewKeys = await client.getTransitionViewKeys({ transactionId: 'at1…' })
 */
export async function getTransitionViewKeys(
  client: Client,
  params: GetTransitionViewKeysParameters,
): Promise<GetTransitionViewKeysReturnType> {
  return client.request({
    method: 'getTransitionViewKeys',
    params: { id: params.transactionId },
  }) as Promise<string[]>
}
