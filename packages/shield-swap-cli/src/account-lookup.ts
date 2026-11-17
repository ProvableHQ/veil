/**
 * Loads signing accounts for Shield Swap sessions.
 *
 * Checks the resolved address against the session state and caches successful
 * lookups to avoid repeated password prompts.
 */
import { createHash } from 'node:crypto'
import { privateKeyToAccount } from '@provablehq/veil-aleo-sdk'
import { KeystoreError, loadAccount, type LoadedAccount } from '@provablehq/veil-aleo-sdk/node'
import type { ShieldSwapState } from './session.js'

/**
 * Lists environment variables whose values affect account lookup.
 */
const LOOKUP_VARIABLES = [
  'ALEO_PRIVATE_KEY',
  'SHIELD_SWAP_PRIVATE_KEY',
  'ALEO_PRIVATE_KEY_FILE',
  'SHIELD_SWAP_PRIVATE_KEY_FILE',
  'ALEO_ACCOUNT',
  'ALEO_ACCOUNTS_DIR',
  'ALEO_ACCOUNT_PASSWORD',
  'HOME',
  'USERPROFILE',
] as const

/**
 * Caches account lookups by a hash of their inputs.
 */
const lookups = new Map<string, Promise<LoadedAccount>>()

/**
 * Selects the account name supplied to the keystore.
 *
 * An explicit name takes precedence over `ALEO_ACCOUNT` and the name in the
 * state file. When `ALEO_ACCOUNT` is set, the keystore reads it directly.
 *
 * @param state Session state containing the saved account name, if any.
 * @param name Optional account name that overrides the environment and state.
 *   When omitted, uses the state name only if `ALEO_ACCOUNT` is unset or empty.
 * @returns The selected name, or `undefined` to let the keystore use
 *   `ALEO_ACCOUNT` or `default`.
 *
 * @example
 * const name = accountName({ account: 'trading' }, 'savings') // 'savings'
 */
export function accountName(state: Pick<ShieldSwapState, 'account'>, name?: string): string | undefined {
  if (name !== undefined) return name
  return process.env.ALEO_ACCOUNT ? undefined : state.account
}

/**
 * Loads a signing account that matches the session's saved address.
 *
 * Checks the explicit key, key environment variables, account file, and key
 * in the state file, in that order. Environment keys are not saved. Reading
 * stored keys may access the macOS Keychain or prompt for a password.
 * When no address is recorded, derives the expected address from the key
 * in the state file before checking any signing source.
 *
 * Caches successful lookups for the process. Changes to the lookup options
 * or environment trigger another lookup; changes to files alone do not.
 * Using a key from the state file prints a migration notice to standard error.
 *
 * @param options Account sources and expected address.
 * @param options.state Session state containing the expected address, saved
 *   account name, and fallback private key.
 * @param options.name Optional account name. Defaults to `ALEO_ACCOUNT`,
 *   then the name in the state file, then `default`.
 * @param options.privateKey Optional private key that overrides other sources.
 *   When omitted, reads the environment, account file, or state file.
 * @returns The signing account, key source, and stored account details, if any.
 * @throws KeystoreError If no key is available, key sources conflict, the key
 *   does not match the saved address, or stored keys cannot be unlocked.
 *
 * @example
 * const { account } = await resolveAccount({ state: { network: 'testnet' } })
 */
export async function resolveAccount(options: {
  state: ShieldSwapState
  name?: string
  privateKey?: string
}): Promise<LoadedAccount> {
  const { state } = options
  const name = accountName(state, options.name)
  // A legacy state with only a key still identifies the account that must sign.
  const expectedAddress =
    state.address ??
    (state.privateKey === undefined ? undefined : accountOfKey(state.privateKey, 'The key in the state file').address)

  // Hash lookup inputs so the cache index does not contain plaintext keys.
  // Use the resolved name so saving it in the state does not change the index.
  const identity = createHash('sha256')
    .update(
      JSON.stringify([
        name ?? (process.env.ALEO_ACCOUNT || 'default'),
        options.privateKey ?? null,
        state.privateKey ?? null,
        LOOKUP_VARIABLES.map((variable) => process.env[variable] ?? null),
      ]),
    )
    .digest('hex')
  const known = lookups.get(identity)
  if (known) {
    const loaded = await known
    // Check the expected address on every call, including cached lookups.
    // Let the keystore report a mismatch if the expected address has changed.
    if (expectedAddress === undefined || loaded.account.address === expectedAddress) return loaded
  }

  const lookup = loadAccount({
    ...(name === undefined ? {} : { name }),
    privateKey: options.privateKey,
    expectedAddress,
    legacyKey: state.privateKey,
  }).then((loaded) => {
    if (loaded.source === 'legacy') {
      console.error(
        `shield-swap: the key of ${loaded.account.address} is still stored in the ${state.network} state file. ` +
          `Move it into an account file with \`shield-swap account migrate --network ${state.network}\`.`,
      )
    }
    return loaded
  })
  lookups.set(identity, lookup)
  // Remove failed lookups so a later call can retry after configuration changes.
  lookup.catch(() => {
    if (lookups.get(identity) === lookup) lookups.delete(identity)
  })
  return lookup
}

/**
 * Validates an Aleo private key and derives its address.
 *
 * Invalid input produces an error that identifies the source without
 * including the key or the underlying parser error.
 *
 * @param privateKey Aleo private key encoded with the `APrivateKey1` prefix.
 * @param origin Description of the key source to include in error messages.
 * @returns The derived address and supplied private key.
 * @throws KeystoreError With code `INVALID_KEY` if the key cannot be parsed.
 *
 * @example
 * const key = process.env.ALEO_PRIVATE_KEY ?? ''
 * const { address } = accountOfKey(key, 'ALEO_PRIVATE_KEY')
 */
export function accountOfKey(privateKey: string, origin: string): { address: string; privateKey: string } {
  try {
    return { address: privateKeyToAccount(privateKey).address, privateKey }
  } catch {
    // Parser errors may include the key; omit the original error and cause.
    throw new KeystoreError('INVALID_KEY', `${origin} is not a valid Aleo private key.`)
  }
}
