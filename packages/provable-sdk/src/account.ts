import { Account } from '@provablehq/sdk'
import type { LocalAccount } from '@provablehq/veil-core'

/**
 * Derives a `LocalAccount` from an Aleo private key.
 *
 * Computes the address and view key and binds `sign` and `signMessage` to the
 * key, without contacting a network. Aleo keys do not depend on the network,
 * so the account is valid on testnet and mainnet alike and no `loadNetwork()`
 * call is needed first.
 *
 * @param privateKey Aleo private key (`APrivateKey1...`).
 * @returns The account for that key, with `source` set to `'privateKey'`.
 * @throws If the string is not a valid Aleo private key.
 *
 * @example
 * import { privateKeyToAccount } from '@provablehq/veil-aleo-sdk'
 *
 * const account = privateKeyToAccount(process.env.ALEO_PRIVATE_KEY!)
 * account.address // 'aleo1...'
 */
export function privateKeyToAccount(privateKey: string): LocalAccount<'privateKey'> {
  const sdkAccount = new Account({ privateKey })
  const address = sdkAccount.address().to_string()
  const viewKey = sdkAccount.viewKey().to_string()

  const signFn = async (message: Uint8Array): Promise<Uint8Array> => {
    const sig = sdkAccount.sign(message)
    return new TextEncoder().encode(sig.to_string())
  }

  return {
    type: 'local',
    source: 'privateKey',
    address,
    privateKey,
    viewKey,
    sign: signFn,
    signMessage: signFn,
  }
}
