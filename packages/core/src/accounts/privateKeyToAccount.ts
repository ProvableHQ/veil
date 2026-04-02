import type { LocalAccount } from '../types/account.js'

type PrivateKeyAccountSource = {
  privateKey: string
  address: string
  viewKey: string
  sign?: (message: Uint8Array) => Promise<Uint8Array>
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>
}

/**
 * Creates a LocalAccount from a private key.
 *
 * Since aleo-viem has no hard dependency on any SDK, the caller must provide
 * the derived address and viewKey. SDK adapter packages (e.g. @aleo-viem/provable)
 * will provide convenience wrappers that derive these automatically.
 */
export function privateKeyToAccount(source: PrivateKeyAccountSource): LocalAccount<'privateKey'> {
  const defaultSign = async (_message: Uint8Array): Promise<Uint8Array> => {
    throw new Error(
      'sign() not implemented. Provide a sign function or use an SDK adapter that implements signing.',
    )
  }

  return {
    type: 'local',
    source: 'privateKey',
    address: source.address,
    privateKey: source.privateKey,
    viewKey: source.viewKey,
    sign: source.sign ?? defaultSign,
    signMessage: source.signMessage ?? defaultSign,
  }
}
