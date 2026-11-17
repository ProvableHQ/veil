/**
 * Resolves the signing account for every `shield-swap` command.
 *
 * Internal to the package. Every command that signs calls
 * {@link resolveAccount}, so they all apply the same lookup order and the same
 * checks against the state file.
 */
import { createHash } from 'node:crypto'
import { privateKeyToAccount } from '@provablehq/veil-aleo-sdk'
import { KeystoreError, loadAccount, type LoadedAccount } from '@provablehq/veil-aleo-sdk/node'
import type { ShieldSwapState } from './session.js'

/** Environment variables that change what a lookup returns. A changed value makes a new lookup. */
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

/** Lookups this process has made, keyed by the digest of their inputs. */
const lookups = new Map<string, Promise<LoadedAccount>>()

/**
 * Picks the account name to pass to the keystore.
 *
 * The order is an explicit name, then `ALEO_ACCOUNT`, then the name recorded
 * in the state file, then `default`. The keystore applies the variable and the
 * default itself, and its `name` option takes precedence over the variable.
 * The recorded name is therefore returned only when no name was given and the
 * variable is unset. Reads the environment and nothing else.
 *
 * @param state State of the selected network. Its `account` is the recorded
 *   name.
 * @param name Optional explicit account name, such as a `--name` flag.
 *   Defaults to the order above.
 * @returns The `name` option for a keystore call, or `undefined` to leave the
 *   choice to `ALEO_ACCOUNT` and the default.
 *
 * @example
 * const name = accountName(loadState('testnet'), 'trading') // 'trading'
 */
export function accountName(state: Pick<ShieldSwapState, 'account'>, name?: string): string | undefined {
  if (name !== undefined) return name
  return process.env.ALEO_ACCOUNT ? undefined : state.account
}

/**
 * Resolves the signing account of a state directory through the keystore.
 *
 * Sources, first match wins: the `privateKey` option, `ALEO_PRIVATE_KEY` and
 * `ALEO_PRIVATE_KEY_FILE` (with their `SHIELD_SWAP_` aliases), the selected
 * account file, then a `privateKey` held by the state file itself. The
 * resolved key MUST derive the address the state records.
 * A key from the environment is used for the process and written nowhere.
 *
 * Reads the environment and the account file, and may run the macOS
 * `security` tool or ask for a password on the terminal. Does not contact a
 * network. A process resolves each account once: a repeated call with the same
 * inputs returns the first result without reading or asking again. When the
 * key comes from the state file, one line on standard error points at
 * `shield-swap account migrate`.
 *
 * @param options.state State of the selected network: its `address` is the
 *   expected address, its `account` the recorded account name and its
 *   `privateKey` the last source.
 * @param options.name Optional explicit account name. Defaults to
 *   `ALEO_ACCOUNT`, then the recorded name, then `default`.
 * @param options.privateKey Optional key supplied by the caller. Takes
 *   precedence over every other source, and the key variables are then not
 *   read. Defaults to the lookup above.
 * @returns The signing account, the source of its key and the account file
 *   when one exists.
 * @throws KeystoreError With the code the keystore reports, such as
 *   `ACCOUNT_NOT_FOUND`, `ADDRESS_MISMATCH`, `KEY_NOT_STORED` or
 *   `PASSWORD_REQUIRED`.
 *
 * @example
 * const { account } = await resolveAccount({ state: loadState('testnet') })
 */
export async function resolveAccount(options: {
  state: ShieldSwapState
  name?: string
  privateKey?: string
}): Promise<LoadedAccount> {
  const { state } = options
  const name = accountName(state, options.name)

  // Everything that selects a key goes into the digest, so a changed variable
  // or state is a new lookup. Keys are hashed, never kept as text. The name is
  // the one the keystore ends up with, so recording it in the state between
  // two lookups does not make the second one a new lookup.
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
    // The recorded address is not part of the digest, because setup records it
    // between two lookups of the same account. A remembered account that does
    // not match it goes through the keystore again, which reports the mismatch.
    if (state.address === undefined || loaded.account.address === state.address) return loaded
  }

  const lookup = loadAccount({
    ...(name === undefined ? {} : { name }),
    privateKey: options.privateKey,
    expectedAddress: state.address,
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
  // A failed lookup is not remembered: the next call may follow a fix, such as
  // an account created in between.
  lookup.catch(() => {
    if (lookups.get(identity) === lookup) lookups.delete(identity)
  })
  return lookup
}

/**
 * Derives the account of a private key string.
 *
 * Computes the address without reading a file or contacting a network.
 *
 * @param privateKey Candidate private key, as text starting with
 *   `APrivateKey1`.
 * @param origin Where the string came from, named in the error message.
 * @returns The address and the key.
 * @throws KeystoreError `INVALID_KEY` when the string is not a private key.
 *   The message names the origin and never the string.
 *
 * @example
 * const { address } = accountOfKey(text, 'The key in the key file')
 */
export function accountOfKey(privateKey: string, origin: string): { address: string; privateKey: string } {
  try {
    return { address: privateKeyToAccount(privateKey).address, privateKey }
  } catch {
    // The underlying error is dropped so nothing derived from the input can
    // reach a log or the terminal through the error chain.
    throw new KeystoreError('INVALID_KEY', `${origin} is not a valid Aleo private key.`)
  }
}
