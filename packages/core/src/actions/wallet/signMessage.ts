import { AccountNotFoundError } from '../../errors/errors.js'
import type { SignerAccount } from '../../types/account.js'
import type { Client } from '../../clients/createClient.js'

/**
 * Parameters for `walletClient.signMessage`.
 *
 * @property message Raw bytes to sign. Callers encode strings themselves (e.g. `new TextEncoder().encode(text)`).
 */
export type SignMessageParameters = {
  message: Uint8Array
}

/** Signature bytes over the message, verifiable against the account's address. */
export type SignMessageReturnType = Uint8Array

/**
 * Signs an arbitrary message with the client's account.
 *
 * Reach for this for off-chain proof of address ownership — login challenges,
 * attestations. Creates no transaction and costs no fee. Local accounts sign
 * in-process with the private key and never touch the network; RPC accounts
 * delegate to the wallet, which prompts the user.
 *
 * @param client Wallet client with an account attached.
 * @param params The bytes to sign.
 * @returns The signature to hand to a verifier.
 * @throws AccountNotFoundError if the client has no account capable of signing messages.
 *
 * @example
 * const signature = await walletClient.signMessage({
 *   message: new TextEncoder().encode('login:2026-07-01'),
 * })
 */
export async function signMessage(
  client: Client,
  params: SignMessageParameters,
): Promise<SignMessageReturnType> {
  const account = client.account
  if (!account || !('signMessage' in account)) {
    throw new AccountNotFoundError()
  }

  // Like viem: if the account has signMessage, call it directly.
  // Both local and RPC accounts implement signMessage —
  // local accounts sign with the private key,
  // RPC accounts delegate to the wallet.
  return (account as SignerAccount).signMessage(params.message)
}
