import { AccountNotFoundError } from '../../errors/errors.js'
import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for `walletClient.decrypt`.
 *
 * `cipherText` alone decrypts a record ciphertext (`record1...`). The four
 * optional fields are only needed for transition output ciphertexts
 * (`ciphertext1...`), which are bound to the transition that produced them.
 *
 * @property cipherText Ciphertext to decrypt: a record (`record1...`) or a transition output (`ciphertext1...`).
 * @property tpk Transition public key of the transition that produced the ciphertext. Required for `ciphertext1...` values; omit for records.
 * @property programId Program that produced the ciphertext, e.g. `credits.aleo`. Required alongside `tpk`.
 * @property functionName Function within `programId` that produced the ciphertext. Required alongside `tpk`.
 * @property index Zero-based position of the ciphertext among the transition's outputs. Required alongside `tpk`.
 */
export type DecryptParameters = {
  cipherText: string
  tpk?: string
  programId?: string
  functionName?: string
  index?: number
}

/** Decrypted Aleo plaintext, e.g. a record's fields or a literal value. */
export type DecryptReturnType = string

/**
 * Decrypts a ciphertext the account's view key can open.
 *
 * Reach for this to read a record returned by an execution, or a private
 * transition output. For local accounts the view key is held locally, so
 * decryption runs in-process via the proving config and never touches the
 * network. For RPC accounts the request goes to the wallet adapter, which
 * holds the view key and may prompt the user.
 *
 * @param client Wallet client with an account attached.
 * @param params Ciphertext, plus transition coordinates when it is a `ciphertext1...` output.
 * @returns The plaintext the view key reveals.
 * @throws AccountNotFoundError if the client has no account.
 * @throws If the ciphertext was not encrypted for this account's view key.
 *
 * @example
 * const plaintext = await walletClient.decrypt({ cipherText: 'record1...' })
 */
export async function decrypt(
  client: Client,
  params: DecryptParameters,
): Promise<DecryptReturnType> {
  const account = client.account
  if (!account) {
    throw new AccountNotFoundError()
  }

  // Local accounts — use the SDK-backed decrypt on the proving config.
  // The wallet adapter transport doesn't apply; we have the view key locally.
  if (account.type === 'local' && client.proving?.decrypt) {
    return client.proving.decrypt(
      params.cipherText,
      params.tpk,
      params.programId,
      params.functionName,
      params.index,
    )
  }

  // RPC accounts — delegate to the wallet adapter via the transport.
  return client.request({
    method: 'decrypt',
    params,
  }) as Promise<string>
}
