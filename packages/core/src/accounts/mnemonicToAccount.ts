import type { LocalAccount } from '../types/account.js'

type MnemonicAccountSource = {
  mnemonic: string
  address: string
  privateKey: string
  viewKey: string
  sign?: (message: Uint8Array) => Promise<Uint8Array>
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>
}

/**
 * Creates a LocalAccount from a mnemonic phrase.
 *
 * Like privateKeyToAccount, the caller must provide derived values.
 * SDK adapter packages will provide convenience wrappers.
 */
export function mnemonicToAccount(source: MnemonicAccountSource): LocalAccount<'mnemonic'> {
  const defaultSign = async (_message: Uint8Array): Promise<Uint8Array> => {
    throw new Error(
      'sign() not implemented. Provide a sign function or use an SDK adapter that implements signing.',
    )
  }

  return {
    type: 'local',
    source: 'mnemonic',
    address: source.address,
    privateKey: source.privateKey,
    viewKey: source.viewKey,
    sign: source.sign ?? defaultSign,
    signMessage: source.signMessage ?? defaultSign,
  }
}
