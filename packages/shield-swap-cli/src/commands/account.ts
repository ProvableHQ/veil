/**
 * Saves an Aleo account for reuse across Shield Swap commands and Veil scripts.
 *
 * Import an existing private key or recovery phrase to keep using the same
 * address and funds. Create an account when a separate address is needed.
 * Once saved, the account can be selected by name without supplying its
 * private key on every run.
 *
 * Use `--storage keychain` on macOS or `--storage encrypted` to protect the
 * private key. Keychain storage keeps the key in the macOS Keychain, outside
 * the account file. Encrypted storage keeps a password-encrypted copy in the
 * file, so the password is needed to unlock it. The default, `plaintext`,
 * writes the key directly into the file: anyone who can read that file can
 * use the account. File permissions restrict access but do not encrypt copies
 * or backups.
 *
 * For an account already saved in plaintext, use `protect --storage keychain`
 * or `protect --storage encrypted`. This changes how the key is stored;
 * the address and funds stay the same. A key still in a Shield Swap state
 * file can be moved with `migrate --storage encrypted --remove-legacy-key`.
 * Without the removal flag, the state file retains a readable copy.
 *
 * Account files live in `~/.aleo/accounts/<name>.json` by default. Use `show`
 * to check the address and storage before trading. Use `export` at a terminal
 * to back up the key or import it into a wallet. These commands do not submit
 * transactions; run `shield-swap setup` to prepare the account for trading.
 */
import { readFileSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { generateAccount, loadNetwork, privateKeyToAccount, validateMnemonic } from '@provablehq/veil-aleo-sdk'
import {
  KeystoreError,
  accountInfo,
  exportAccount,
  loadAccount,
  migrateAccount,
  protectAccount,
  saveAccount,
  type AccountStorage,
  type StoredAccount,
} from '@provablehq/veil-aleo-sdk/node'
import { accountOfKey } from '../account-lookup.js'
import { help, red } from '../color.js'
import { resolveNetwork } from '../session.js'
import { existingStatePath, statePath, stateFiles, writeStateFile } from '../state-files.js'
import { terminal } from '../terminal.js'

/** Describes account commands and options for help and usage errors. */
const USAGE = `shield-swap account — save an Aleo account for trading and scripts

Usage: shield-swap account <command> [options]

Import an existing key or recovery phrase to keep the same address and funds.
Create an account when a separate address is needed.

Use --storage keychain on macOS or --storage encrypted to protect the key.
Keychain keeps the key outside the account file; encrypted storage requires
a password to unlock the key in the file. The default is plaintext: anyone
who can read the account file can use its private key.

  create     generate a key and store it
  import     store an existing key, or the account of a recovery phrase
  show       print the address, account name and storage type; never the key
  protect    change how the key is stored
  export     print the private key; requires a terminal
  migrate    copy a key from a legacy state.json or profile.json into an account file

Every command:
  --name <name>            account name; default ALEO_ACCOUNT, then default
  --dir <path>             accounts directory; default ALEO_ACCOUNTS_DIR, then ~/.aleo/accounts
  --json                   one machine-readable object on standard output

create, import, protect, migrate:
  --storage <type>         plaintext, keychain (macOS) or encrypted; none on create and import
  --save-password          also save the password in the macOS Keychain (encrypted storage)

create:
  --mnemonic               derive the key from a new recovery phrase, shown once and stored nowhere

import:
  --key-file <path>        text file holding the private key
  --mnemonic-file <path>   text file holding a recovery phrase
  --index <n>              account index for a recovery phrase; default 0
  --derivation <id>        standard (default) or legacy

protect:
  --forget-password        remove a saved password from the macOS Keychain

migrate:
  --from <path>            the legacy file; default the state.json of the selected network
  --network <network>      testnet (default) or mainnet; selects that state.json
  --remove-legacy-key      strip the key from the legacy file once the new account is confirmed

--storage defaults to plaintext, except on protect, which requires it unless
--forget-password is given alone. import reads --key-file or --mnemonic-file,
then ALEO_PRIVATE_KEY or ALEO_PRIVATE_KEY_FILE, then asks at a hidden prompt. A
password is never taken from the command line: it comes from
ALEO_ACCOUNT_PASSWORD, the macOS Keychain or a hidden prompt.

Exit codes: 0 done · 1 failed · 2 needs a person (no account, no stored key,
no password, no terminal) · 64 usage error.`

/** Indicates successful completion. */
const EXIT_DONE = 0
/** Indicates a command failure or declined key export. */
const EXIT_FAILED = 1
/** Indicates missing account credentials or a required terminal. */
const EXIT_NEEDS_PERSON = 2
/** Indicates invalid command arguments. */
const EXIT_USAGE = 64

/**
 * Maps missing account credentials and terminal requirements to exit code 2.
 *
 * These errors require configuration or input before the command can succeed.
 */
const NEEDS_PERSON = new Set(['ACCOUNT_NOT_FOUND', 'KEY_NOT_STORED', 'PASSWORD_REQUIRED', 'TERMINAL_REQUIRED'])

/** Lists environment variables that select a private key for import. */
const KEY_VARIABLES = [
  'ALEO_PRIVATE_KEY',
  'SHIELD_SWAP_PRIVATE_KEY',
  'ALEO_PRIVATE_KEY_FILE',
  'SHIELD_SWAP_PRIVATE_KEY_FILE',
] as const

/** Identifies private keys entered at the key-or-phrase prompt. */
const KEY_PREFIX = 'APrivateKey1'
/** Limits mnemonic account indexes to 2^31 - 1 for hardened derivation. */
const MAX_INDEX = 2 ** 31 - 1
/** Lists the supported account subcommands in help order. */
const COMMANDS = ['create', 'import', 'show', 'protect', 'export', 'migrate'] as const
/** Identifies a supported account subcommand. */
type CommandName = (typeof COMMANDS)[number]

/** Defines accepted flag types and aliases for argument parsing. */
const OPTIONS = {
  name: { type: 'string' },
  dir: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  'no-color': { type: 'boolean' },
  storage: { type: 'string' },
  'save-password': { type: 'boolean' },
  'forget-password': { type: 'boolean' },
  mnemonic: { type: 'boolean' },
  'key-file': { type: 'string' },
  'mnemonic-file': { type: 'string' },
  index: { type: 'string' },
  derivation: { type: 'string' },
  from: { type: 'string' },
  'remove-legacy-key': { type: 'boolean' },
  network: { type: 'string' },
} as const

/** Lists flags accepted by every account subcommand. */
const COMMON_FLAGS = ['name', 'dir', 'json', 'help', 'no-color']

/** Lists additional flags accepted by each subcommand. */
const COMMAND_FLAGS: Record<CommandName, readonly string[]> = {
  create: ['storage', 'save-password', 'mnemonic'],
  import: ['storage', 'save-password', 'key-file', 'mnemonic-file', 'index', 'derivation'],
  show: [],
  protect: ['storage', 'save-password', 'forget-password'],
  export: [],
  migrate: ['storage', 'save-password', 'from', 'remove-legacy-key', 'network'],
}

/** Lists storage types supported by each subcommand that writes an account. */
const COMMAND_STORAGE: Partial<Record<CommandName, readonly AccountStorage[]>> = {
  create: ['plaintext', 'keychain', 'encrypted', 'none'],
  import: ['plaintext', 'keychain', 'encrypted', 'none'],
  protect: ['plaintext', 'keychain', 'encrypted'],
  migrate: ['plaintext', 'keychain', 'encrypted'],
}

/**
 * Describes a validated account command and its options.
 *
 * @property command Subcommand to execute.
 * @property name Optional account name. Defaults to `ALEO_ACCOUNT`, then `default`.
 * @property dir Optional accounts directory. Defaults to `ALEO_ACCOUNTS_DIR`,
 *   then `~/.aleo/accounts`.
 * @property json Prints results and keystore errors as JSON. Defaults to false.
 *   Commands that display secrets reject this option.
 * @property storage Optional key storage. Defaults to `plaintext` for `create`,
 *   `import`, and `migrate`. Required for `protect` unless only removing a
 *   saved password. Prefer `keychain` on macOS or `encrypted` to avoid a
 *   readable private key in the account file. `none` saves only the address
 *   and requires an external key on each run.
 * @property savePassword Saves an encrypted account's password in the macOS
 *   Keychain for subsequent runs. Defaults to false.
 * @property forgetPassword Removes the password saved in the macOS Keychain.
 *   Applies to `protect` and defaults to false.
 * @property mnemonic Generates a recovery phrase and displays it once during
 *   `create`. Defaults to false.
 * @property keyFile Optional file containing the private key to import. When
 *   neither file option is supplied, import checks the environment, then prompts.
 * @property mnemonicFile Optional file containing the recovery phrase to import.
 *   Cannot be combined with `keyFile`.
 * @property index Mnemonic account index, an integer from 0 to 2^31 - 1.
 *   Defaults to 0.
 * @property derivation Mnemonic path convention. Defaults to `standard`, which
 *   uses the Aleo coin type at `m/44'/683'`; `legacy` uses `m/44'/0'`.
 * @property from Optional migration source. Defaults to the selected network's
 *   Shield Swap state file.
 * @property removeLegacyKey Removes the source key after verifying the stored
 *   account can be read. Applies to `migrate` and defaults to false.
 * @property network Optional network for the default migration source. Defaults
 *   to `SHIELD_SWAP_NETWORK`, then `testnet`. Ignored when `from` is supplied.
 */
type Args = {
  command: CommandName
  name?: string
  dir?: string
  json: boolean
  storage?: AccountStorage
  savePassword: boolean
  forgetPassword: boolean
  mnemonic: boolean
  keyFile?: string
  mnemonicFile?: string
  index: number
  derivation: 'standard' | 'legacy'
  from?: string
  removeLegacyKey: boolean
  network?: string
}

/**
 * Prints an argument error and command usage, then exits with code 64.
 *
 * @param message Explanation of the invalid or missing argument.
 */
function usageError(message: string): never {
  console.error(`${red(message, 'stderr')}\n\n${help(USAGE)}`)
  process.exit(EXIT_USAGE)
}

/**
 * Validates an account subcommand and its flags.
 *
 * Accepts flags before or after the subcommand name. Invalid arguments print
 * usage and exit with code 64, including flags that belong to another command.
 *
 * @param argv Arguments following `shield-swap account`.
 * @returns Validated options, or `undefined` when help was requested.
 */
function parse(argv: string[]): Args | undefined {
  let values: Record<string, string | boolean | undefined>
  let positionals: string[]
  // Convert argument parsing failures to usage errors.
  try {
    ;({ values, positionals } = parseArgs({ options: OPTIONS, args: argv, allowPositionals: true, strict: true }) as {
      values: Record<string, string | boolean | undefined>
      positionals: string[]
    })
  } catch (error) {
    usageError((error as Error).message)
  }
  if (values.help) return undefined

  const [command, ...extra] = positionals
  if (command === undefined) usageError(`a command is required: ${COMMANDS.slice(0, -1).join(', ')} or ${COMMANDS.at(-1)}`)
  if (!(COMMANDS as readonly string[]).includes(command)) usageError(`unknown account command \`${command}\`.`)
  if (extra.length) usageError(`unexpected argument \`${extra[0]}\`.`)
  const name = command as CommandName

  for (const flag of Object.keys(values)) {
    if (!COMMON_FLAGS.includes(flag) && !COMMAND_FLAGS[name].includes(flag)) {
      usageError(`--${flag} does not apply to \`account ${name}\`.`)
    }
  }

  const storage = values.storage as string | undefined
  const allowed = COMMAND_STORAGE[name]
  if (storage !== undefined && allowed && !(allowed as readonly string[]).includes(storage)) {
    usageError(`--storage for \`account ${name}\` is one of ${allowed.join(', ')}, got "${storage}".`)
  }
  if (name === 'protect') {
    if (storage === undefined && !values['forget-password']) {
      usageError('protect needs --storage, or --forget-password to only remove a saved password.')
    }
    if (values['save-password'] && values['forget-password']) {
      usageError('--save-password and --forget-password cannot be combined.')
    }
  }
  if (values['key-file'] !== undefined && values['mnemonic-file'] !== undefined) {
    usageError('--key-file and --mnemonic-file cannot be combined.')
  }
  const indexText = (values.index as string | undefined) ?? '0'
  if (!/^\d+$/.test(indexText) || Number(indexText) > MAX_INDEX) {
    usageError(`--index takes a whole number from 0 through ${MAX_INDEX}, got "${indexText}".`)
  }
  const derivation = (values.derivation as string | undefined) ?? 'standard'
  if (derivation !== 'standard' && derivation !== 'legacy') {
    usageError(`--derivation is standard or legacy, got "${derivation}".`)
  }
  const network = values.network as string | undefined
  if (network !== undefined && network !== 'testnet' && network !== 'mainnet') {
    usageError(`--network is testnet or mainnet, got "${network}".`)
  }

  return {
    command: name,
    name: values.name as string | undefined,
    dir: values.dir as string | undefined,
    json: values.json === true,
    storage: storage as AccountStorage | undefined,
    savePassword: values['save-password'] === true,
    forgetPassword: values['forget-password'] === true,
    mnemonic: values.mnemonic === true,
    keyFile: values['key-file'] as string | undefined,
    mnemonicFile: values['mnemonic-file'] as string | undefined,
    index: Number(indexText),
    derivation,
    from: values.from as string | undefined,
    removeLegacyKey: values['remove-legacy-key'] === true,
    network,
  }
}

/** Writes command output followed by a newline. */
function out(text: string): void {
  console.log(text)
}

/**
 * Prints account details as JSON or a supplied text message.
 *
 * @param stored Saved account details to include in JSON output.
 * @param json Selects a JSON object with `name`, `address`, `storage`, and `path`.
 * @param sentence Message to print when JSON output is disabled.
 */
function report(stored: StoredAccount, json: boolean, sentence: string): void {
  out(
    json
      ? JSON.stringify({ name: stored.name, address: stored.address, storage: stored.storage, path: stored.path })
      : sentence,
  )
}

/**
 * Formats a message describing the saved account and its location.
 *
 * @param stored Account name, address, storage type, and file path.
 * @param verb Completed action to name in the message, such as `Created`.
 * @returns A sentence suitable for command output.
 */
function summary(stored: StoredAccount, verb: string): string {
  return `${verb} Aleo account ${stored.name} (${stored.address}) with ${stored.storage} storage in ${stored.path}.`
}

/**
 * Requires terminal input and output before a command displays a secret.
 *
 * @param what Command name to include in an error message.
 * @param json Whether JSON output was requested; secret output rejects it.
 * @param secret Description of the secret being displayed. Defaults to
 *   `the private key`.
 * @throws KeystoreError With code `TERMINAL_REQUIRED` if JSON output is
 *   requested or standard input, output, or error is not a terminal.
 */
function requireTerminal(what: string, json: boolean, secret = 'the private key'): void {
  if (json) {
    throw new KeystoreError(
      'TERMINAL_REQUIRED',
      `${what} shows ${secret} to a person at a terminal and has no --json output.`,
    )
  }
  if (!(terminal.attached() && terminal.outputIsTerminal())) {
    throw new KeystoreError(
      'TERMINAL_REQUIRED',
      `${what} shows ${secret} and runs only with a terminal attached to its input and output.`,
    )
  }
}

/**
 * Reports storage options or protections unavailable on the current system.
 *
 * Warns when password saving does not apply or Windows file permissions
 * cannot enforce owner-only access. Writes notices to standard error.
 *
 * @param stored Saved account's storage type and path.
 * @param savePassword Whether password saving was requested.
 */
function storageNotes(stored: StoredAccount, savePassword: boolean): void {
  if (savePassword && !(stored.storage === 'encrypted' && terminal.platform === 'darwin')) {
    terminal.notify('--save-password applies to encrypted storage on macOS only; no password was saved.')
  }
  if (stored.storage === 'plaintext' && terminal.platform === 'win32') {
    terminal.notify(
      `Windows does not enforce owner-only file modes: ${stored.path} is protected only by the ` +
        'access rules of its folder.',
    )
  }
}

/**
 * Builds the selected account file path for diagnostic messages.
 *
 * Reads account settings from the options and environment. Expands a leading
 * `~` to the home directory without checking whether the file exists.
 *
 * @param args Account name and directory overrides. Uses the keystore's
 *   environment settings and defaults when omitted.
 * @returns The absolute path to `<name>.json`.
 */
function accountFilePath(args: Pick<Args, 'name' | 'dir'>): string {
  const home = homedir()
  let dir = args.dir || process.env.ALEO_ACCOUNTS_DIR || join(home, '.aleo', 'accounts')
  if (dir === '~') dir = home
  else if (dir.startsWith('~/') || (terminal.platform === 'win32' && dir.startsWith('~\\'))) dir = join(home, dir.slice(2))
  return join(resolve(dir), `${args.name ?? (process.env.ALEO_ACCOUNT || 'default')}.json`)
}

/**
 * Reads the selected account's address and storage details.
 *
 * Does not decrypt the private key or request a password.
 *
 * @param args Account name and directory to inspect.
 * @returns The account name, address, storage type, and file path.
 * @throws KeystoreError With code `ACCOUNT_NOT_FOUND` if the file is missing.
 *   Also propagates account file validation and read errors.
 */
async function existingAccount(args: Args): Promise<StoredAccount> {
  const stored = await accountInfo({ name: args.name, dir: args.dir })
  if (!stored) throw new KeystoreError('ACCOUNT_NOT_FOUND', `There is no account file at ${accountFilePath(args)}.`)
  return stored
}

/**
 * Reads a private key or recovery phrase from a UTF-8 file.
 *
 * @param path File path, used without expanding `~`.
 * @param origin Description of the source to include in error messages.
 * @returns File contents with surrounding whitespace and a leading byte-order
 *   mark removed.
 * @throws KeystoreError With code `EMPTY_KEY_SOURCE` if the file cannot be
 *   read or contains no non-whitespace characters.
 */
async function readKeyText(path: string, origin: string): Promise<string> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (cause) {
    const code = (cause as { code?: string } | undefined)?.code ?? 'unknown error'
    throw new KeystoreError('EMPTY_KEY_SOURCE', `${origin} could not be read (${code}).`, { cause })
  }
  const text = content.trim()
  if (!text) throw new KeystoreError('EMPTY_KEY_SOURCE', `${origin} is empty.`)
  return text
}

/**
 * Validates a BIP-39 recovery phrase and derives an Aleo account.
 *
 * Converts the phrase to lowercase and replaces repeated whitespace with
 * single spaces before checking its English words, word count, and checksum.
 * Does not contact the network or store the phrase.
 *
 * @param text Recovery phrase to validate.
 * @param index Account index, an integer from 0 to 2^31 - 1.
 * @param derivation Uses the standard Aleo derivation path or the legacy path.
 * @returns The derived account address and private key.
 * @throws KeystoreError With code `INVALID_MNEMONIC` if validation fails.
 *   The error message does not include the phrase.
 */
async function accountOfPhrase(
  text: string,
  index: number,
  derivation: 'standard' | 'legacy',
): Promise<{ address: string; privateKey: string }> {
  const phrase = text.trim().split(/\s+/).join(' ').toLowerCase()
  if (!validateMnemonic(phrase)) {
    throw new KeystoreError(
      'INVALID_MNEMONIC',
      'Not a valid recovery phrase: it fails the BIP-39 English word list, the word count or the checksum.',
    )
  }
  // Account derivation is the same on testnet and mainnet.
  const aleo = await loadNetwork('testnet')
  const { address, privateKey } = aleo.mnemonicToAccount(phrase, { index, derivation })
  return { address, privateKey }
}

/**
 * Loads an import key from the configured environment variables.
 *
 * Uses the keystore's validation for empty, invalid, or conflicting sources.
 * Reads a key file when a file variable is set; does not prompt for a password.
 *
 * @param args Account name and directory to check for an existing account.
 * @returns The private key and its derived address.
 * @throws KeystoreError If key sources are empty, invalid, or conflicting.
 *   Uses `ACCOUNT_EXISTS` if the key conflicts with the selected account file.
 */
async function accountFromEnvironment(args: Args): Promise<{ address: string; privateKey: string }> {
  try {
    // Resolve the environment key without unlocking stored keys or prompting.
    const { account } = await loadAccount({ name: args.name, dir: args.dir, prompt: false })
    return { address: account.address, privateKey: account.privateKey }
  } catch (error) {
    if (!(error instanceof KeystoreError) || error.code !== 'ADDRESS_MISMATCH') throw error
    // Report a conflicting import as ACCOUNT_EXISTS to preserve the saved account.
    const existing = await accountInfo({ name: args.name, dir: args.dir })
    if (!existing) throw error
    throw new KeystoreError(
      'ACCOUNT_EXISTS',
      `Account file ${existing.path} already holds ${existing.address}; refusing to replace it with the ` +
        'key supplied through the environment. Choose another account name.',
    )
  }
}

/**
 * Reads or prompts for the account key to import.
 *
 * Checks `--key-file` or `--mnemonic-file`, then environment variables, then
 * a hidden terminal prompt. Recovery phrases are converted to private keys.
 *
 * @param args Import source and mnemonic derivation options.
 * @returns The private key and its derived address.
 * @throws KeystoreError If no source is available, input is empty or invalid,
 *   or environment key sources conflict with each other or a saved account.
 */
async function accountToImport(args: Args): Promise<{ address: string; privateKey: string }> {
  if (args.keyFile !== undefined) {
    const origin = `The key file ${args.keyFile}`
    return accountOfKey(await readKeyText(args.keyFile, origin), origin)
  }
  if (args.mnemonicFile !== undefined) {
    const phrase = await readKeyText(args.mnemonicFile, `The recovery phrase file ${args.mnemonicFile}`)
    return accountOfPhrase(phrase, args.index, args.derivation)
  }
  if (KEY_VARIABLES.some((variable) => process.env[variable] !== undefined)) return accountFromEnvironment(args)
  if (!terminal.attached()) {
    throw new KeystoreError(
      'ACCOUNT_NOT_FOUND',
      'No key to import: pass --key-file or --mnemonic-file, set ALEO_PRIVATE_KEY or ' +
        'ALEO_PRIVATE_KEY_FILE, or run with a terminal attached.',
    )
  }
  const typed = (await terminal.promptHidden('Private key or recovery phrase to import: ')).trim()
  if (!typed) throw new KeystoreError('EMPTY_KEY_SOURCE', 'No key or recovery phrase was entered.')
  // The private key prefix selects key validation; other input uses BIP-39.
  if (typed.startsWith(KEY_PREFIX)) return accountOfKey(typed, 'The key entered at the prompt')
  return accountOfPhrase(typed, args.index, args.derivation)
}

/**
 * Creates a new Aleo address and saves its private key for later use.
 *
 * Use when a separate account is needed; use `import` to continue with an
 * existing address and its funds. Choose `--storage keychain` on macOS or
 * `--storage encrypted` to protect the key. Omitting `--storage` saves the
 * key as readable text in the account file.
 *
 * Add `--mnemonic` to obtain a recovery phrase for restoring the account in
 * a wallet. The phrase is displayed once and is not saved. With `--storage
 * none`, only the address is saved, so the displayed private key must be
 * retained separately. Both options require a terminal and reject JSON output.
 *
 * @param args Account location, storage, and recovery phrase options.
 * @returns Exit code 0 after saving the account and printing its details.
 * @throws KeystoreError If the account file exists, required terminal access
 *   is unavailable, or the selected storage cannot save the account.
 */
async function create(args: Args): Promise<number> {
  const storage = args.storage ?? 'plaintext'
  // Check terminal requirements before generating secrets or writing files.
  if (args.mnemonic) requireTerminal('create --mnemonic', args.json, 'the recovery phrase')
  if (storage === 'none') requireTerminal('create --storage none', args.json)

  let phrase: string | undefined
  let account: { address: string; privateKey: string }
  if (args.mnemonic) {
    // Generate a 12-word phrase and derive account 0 on the standard Aleo path.
    const generated = (await loadNetwork('testnet')).generateMnemonicAccount()
    phrase = generated.mnemonic
    account = generated.account
  } else {
    account = generateAccount()
  }

  const stored = await saveAccount(account, {
    name: args.name,
    dir: args.dir,
    storage,
    savePassword: args.savePassword,
  })
  report(stored, args.json, summary(stored, 'Created'))
  storageNotes(stored, args.savePassword)

  // Print recovery details only after the account file has been saved.
  if (phrase !== undefined) {
    out(`Recovery phrase: ${phrase}`)
    terminal.notify(
      'This phrase is shown once and stored nowhere. Write it down and keep it offline. ' +
        'A wallet imports this account from it, and whoever holds it controls every account ' +
        'derived from it.',
    )
  }
  if (storage === 'none') {
    out(`Private key: ${account.privateKey}`)
    terminal.notify(
      'This key is stored nowhere. Keep it safe and supply it through ALEO_PRIVATE_KEY or ' +
        'ALEO_PRIVATE_KEY_FILE on every run.',
    )
  } else if (storage === 'keychain' && phrase === undefined) {
    terminal.notify(
      'The key of this account exists only in the macOS Keychain of this Mac. ' +
        'Back it up with: shield-swap account export',
    )
  }
  return EXIT_DONE
}

/**
 * Makes an existing Aleo account available to Shield Swap commands and scripts.
 *
 * Import a key or recovery phrase to keep using the account's address and
 * funds. Supply a file, set a key environment variable, or enter the secret
 * at the hidden prompt. For a recovery phrase, the account index and
 * derivation path must match those used by the original wallet.
 *
 * Prefer `--storage keychain` on macOS or `--storage encrypted`; the default
 * stores the private key as readable text. Only the derived key is saved,
 * not the recovery phrase. Import leaves the source file unchanged, so an
 * unencrypted key or phrase in that file still needs protection.
 *
 * @param args Import source, account location, derivation, and storage options.
 * @returns Exit code 0 after saving the account and printing its details.
 * @throws KeystoreError If the input cannot be read or validated, the account
 *   file contains a different account or storage type, or saving fails.
 */
async function importAccount(args: Args): Promise<number> {
  const account = await accountToImport(args)
  const stored = await saveAccount(account, {
    name: args.name,
    dir: args.dir,
    storage: args.storage ?? 'plaintext',
    savePassword: args.savePassword,
  })
  report(stored, args.json, summary(stored, 'Imported'))
  storageNotes(stored, args.savePassword)
  return EXIT_DONE
}

/**
 * Prints an account's name, address, storage type, and file path.
 *
 * Use before trading to confirm the selected address and check whether its
 * key uses plaintext, encrypted, or Keychain storage. No password is needed,
 * and the private key is not displayed.
 *
 * @param args Account location and text or JSON output selection.
 * @returns Exit code 0 after printing the account details.
 * @throws KeystoreError If the account file is missing or invalid.
 */
async function show(args: Args): Promise<number> {
  const stored = await existingAccount(args)
  report(
    stored,
    args.json,
    `name:    ${stored.name}\naddress: ${stored.address}\nstorage: ${stored.storage}\npath:    ${stored.path}`,
  )
  return EXIT_DONE
}

/**
 * Checks whether a JSON file contains a private key for the given address.
 *
 * @param path File to check for a `privateKey` or `private_key` field.
 * @param address Address the key must derive.
 * @returns True if a matching key is found. Returns false for missing,
 *   unreadable, or invalid files.
 */
function holdsKeyOf(path: string, address: string): boolean {
  try {
    const content = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> | null
    for (const field of ['privateKey', 'private_key']) {
      const key = content?.[field]
      if (typeof key === 'string' && key && privateKeyToAccount(key).address === address) return true
    }
  } catch {
    // Ignore files whose contents cannot be read or validated as a private key.
  }
  return false
}

/**
 * Warns about plaintext copies of a protected account's key.
 *
 * Checks the current Shield Swap state directory and
 * `~/.shield-swap/profile.json`. Prints a migration command to standard error
 * for each matching key. Does not modify files or search other directories.
 *
 * @param stored Account address and storage type after protection changes.
 * @param args Account directory override to include in migration instructions.
 */
function warnLegacyCopies(stored: StoredAccount, args: Args): void {
  const candidates = [...stateFiles(), join(homedir(), '.shield-swap', 'profile.json')]
  for (const path of candidates) {
    if (!holdsKeyOf(path, stored.address)) continue
    const location = `--name ${stored.name}${args.dir === undefined ? '' : ` --dir ${args.dir}`}`
    terminal.notify(
      `A plaintext copy of the key of ${stored.address} remains in ${path}, so ${stored.storage} storage ` +
        'does not protect it yet. Remove it with: shield-swap account migrate ' +
        `--from ${path} --storage ${stored.storage} --remove-legacy-key ${location}`,
    )
  }
}

/**
 * Changes how an existing account's private key is protected without changing its address.
 *
 * Use `--storage keychain` on macOS or `--storage encrypted` to replace a
 * readable key in an account file with protected storage. Keychain keeps the
 * key outside the file; encryption requires a password to read it. Selecting
 * `plaintext` makes the key readable in the file again. These changes do not
 * move funds, and copies in other files or backups are not changed.
 *
 * For an encrypted account, `--storage encrypted` sets a new password.
 * Use `--forget-password` alone to keep the password but remove its saved
 * Keychain copy, so later runs must obtain it from the environment or a
 * prompt. Removing the saved copy also requires the current password.
 *
 * @param args Account location, storage, and password saving options.
 * @returns Exit code 0 after the update, or if the account uses storage that
 *   has no saved password to remove.
 * @throws KeystoreError If the account is missing, cannot be unlocked or
 *   saved, or `--forget-password` without `--storage` is used outside macOS.
 */
async function protect(args: Args): Promise<number> {
  const storage = args.storage
  if (storage === undefined) {
    // Without --storage, remove only the saved password of an encrypted account.
    const existing = await existingAccount(args)
    if (terminal.platform !== 'darwin') {
      throw new KeystoreError('KEYCHAIN_UNAVAILABLE', 'A saved password exists only in the macOS Keychain.')
    }
    if (existing.storage !== 'encrypted') {
      report(
        existing,
        args.json,
        `Aleo account ${existing.name} (${existing.address}) has ${existing.storage} storage and no saved password.`,
      )
      return EXIT_DONE
    }
    // Re-encrypt with the current password and disable password saving.
    // Request the password explicitly because it will be needed on later runs.
    let password = process.env.ALEO_ACCOUNT_PASSWORD || undefined
    if (password === undefined) {
      if (!terminal.attached()) {
        throw new KeystoreError(
          'PASSWORD_REQUIRED',
          `Removing the saved password of ${existing.address} encrypts the account again under its current password. ` +
            'Set ALEO_ACCOUNT_PASSWORD or run with a terminal attached.',
        )
      }
      password = await terminal.promptHidden(`Current password for Aleo account ${existing.name} (${existing.address}): `)
    }
    const kept = await protectAccount({
      name: args.name,
      dir: args.dir,
      storage: 'encrypted',
      password,
      newPassword: password,
      savePassword: false,
      prompt: false,
    })
    report(kept, args.json, `Removed the saved password of Aleo account ${kept.name} (${kept.address}) from the Keychain.`)
    return EXIT_DONE
  }
  // Reject address-only storage even if this handler is called without parsing.
  if (storage === 'none') throw new KeystoreError('UNSUPPORTED_STORAGE', 'An account cannot be moved to "none" storage.')
  const stored = await protectAccount({ name: args.name, dir: args.dir, storage, savePassword: args.savePassword })
  report(stored, args.json, summary(stored, 'Stored'))
  storageNotes(stored, args.savePassword)
  // Report plaintext copies that remain outside the protected account file.
  if (stored.storage === 'keychain' || stored.storage === 'encrypted') warnLegacyCopies(stored, args)
  return EXIT_DONE
}

/**
 * Displays a stored private key for backup or import into another wallet.
 *
 * Requires confirmation at a terminal because anyone with the key can use
 * the account. Encrypted accounts must be unlocked before the key is shown.
 * Redirected output and JSON output are refused to avoid exposing the key
 * in a file, pipe, or automation log.
 *
 * @param args Account location and output options.
 * @returns Exit code 0 after printing the key, or 1 if confirmation is declined.
 * @throws KeystoreError If terminal requirements are not met, the account is
 *   missing, no key is stored, or the stored key cannot be unlocked.
 */
async function exportKey(args: Args): Promise<number> {
  requireTerminal('export', args.json)
  const stored = await existingAccount(args)
  const answer = await terminal.promptVisible(
    `Show the private key of Aleo account ${stored.name} (${stored.address}) on this terminal? [y/N] `,
  )
  if (!['y', 'yes'].includes(answer.trim().toLowerCase())) {
    terminal.notify('Not confirmed. The key was not shown.')
    return EXIT_FAILED
  }
  out(await exportAccount({ name: args.name, dir: args.dir }))
  return EXIT_DONE
}

/**
 * Resolves a file path for comparison, following symbolic links when possible.
 *
 * @param path File path to normalize.
 * @returns The resolved filesystem path, or an absolute path if resolution fails.
 */
function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Saves the account name in a Shield Swap state file for subsequent sessions.
 *
 * Adds the address if missing so the session remains configured after its
 * private key is removed. Preserves other fields and writes with mode 0600.
 *
 * @param path State file to read and update.
 * @param account Name and address of the account containing the migrated key.
 * @returns Resolves after saving, or without writing if both fields are set.
 * @throws If the state file cannot be read, parsed, or written.
 */
async function recordAccount(path: string, account: { name: string; address: string }): Promise<void> {
  const state = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  if (state.account === account.name && state.address) return
  state.account = account.name
  state.address ||= account.address
  writeStateFile(path, state)
}

/**
 * Finds the Shield Swap state path used as the default migration source.
 *
 * @param network Optional network selection. Defaults to `SHIELD_SWAP_NETWORK`,
 *   then `testnet`.
 * @returns An existing state path, or the network's expected path if none exists.
 * @throws If the selected network is neither `testnet` nor `mainnet`.
 */
function ownStatePath(network: string | undefined): string {
  const selected = resolveNetwork(network)
  return existingStatePath(selected) ?? statePath(selected)
}

/**
 * Imports an account from a Shield Swap state or profile file without changing its address.
 *
 * Use when the private key is still stored in `state.json` or `profile.json`.
 * The address and funds stay the same. Choose `--storage keychain` on macOS
 * or `--storage encrypted` and add `--remove-legacy-key` to remove the readable
 * source copy after the saved key has been verified. Without that flag,
 * protecting the new account file leaves the source key exposed.
 *
 * Reads the selected network's state file unless `--from` names another file.
 * Recognized Shield Swap state files are updated to select the migrated
 * account on subsequent runs.
 *
 * @param args Source file, destination account, storage, and key removal options.
 * @returns Exit code 0 after saving the account and reporting the source key status.
 * @throws KeystoreError If the source has no key, the destination conflicts
 *   with another account, or the selected storage fails. File read, parse,
 *   and write errors are also propagated.
 */
async function migrate(args: Args): Promise<number> {
  // Default to the selected network's Shield Swap state file.
  const from = args.from ?? ownStatePath(args.network)
  const { legacyKeyRemoved, ...stored } = await migrateAccount({
    from,
    name: args.name,
    dir: args.dir,
    storage: args.storage ?? 'plaintext',
    savePassword: args.savePassword,
    removeLegacyKey: args.removeLegacyKey,
  })
  // Save the account name in recognized state files for subsequent sessions.
  if (stateFiles().some((path) => canonical(path) === canonical(from))) await recordAccount(from, stored)

  report(stored, args.json, summary(stored, 'Migrated'))
  storageNotes(stored, args.savePassword)
  if (legacyKeyRemoved) {
    terminal.notify(`The key was removed from ${from}.`)
  } else {
    terminal.notify(
      `A plaintext copy of the key remains in ${from}. ` +
        'Run migrate again with --remove-legacy-key to strip it.',
    )
  }
  return EXIT_DONE
}

/** Maps each account subcommand to its handler. */
const HANDLERS: Record<CommandName, (args: Args) => Promise<number>> = {
  create,
  import: importAccount,
  show,
  protect,
  export: exportKey,
  migrate,
}

/**
 * Provides account creation, import, and key protection through the CLI.
 *
 * Scripts can use `--json` to read account details and keystore errors.
 * Commands that display a private key or recovery phrase require a terminal
 * and reject JSON output. No transactions are submitted by these commands.
 *
 * Sets `process.exitCode` to 1 on failure or 2 when account credentials or a
 * required terminal are missing. Invalid arguments print usage and exit
 * with code 64.
 *
 * @param argv Subcommand and flags following `shield-swap account`.
 * @returns Resolves after printing help, account details, or an error.
 *
 * @example
 * await main(['show', '--name', 'trading', '--json'])
 */
export async function main(argv: string[]): Promise<void> {
  const args = parse(argv)
  if (!args) {
    console.log(help(USAGE))
    return
  }
  try {
    const status = await HANDLERS[args.command](args)
    if (status !== EXIT_DONE) process.exitCode = status
  } catch (error) {
    if (error instanceof KeystoreError) {
      if (args.json) out(JSON.stringify({ error: { code: error.code, message: error.message } }))
      else terminal.notify(`${error.code}: ${error.message}`)
      process.exitCode = NEEDS_PERSON.has(error.code) ? EXIT_NEEDS_PERSON : EXIT_FAILED
      return
    }
    // Report other failures as a single message on standard error.
    terminal.notify(`shield-swap account: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = EXIT_FAILED
  }
}
