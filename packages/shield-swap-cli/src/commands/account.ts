/**
 * `shield-swap account` — store an Aleo account on this machine and inspect it.
 *
 * Six commands over the account keystore of `@provablehq/veil-aleo-sdk/node`:
 *
 *   create    generate a key and store it
 *   import    store an existing key, or the account of a recovery phrase
 *   show      print the address, account name and storage type; never the key
 *   protect   change how the key is stored
 *   export    print the key for a person at a terminal
 *   migrate   copy a key out of a legacy state file into an account file
 *
 * None of them contacts a network, authenticates or requests funds. A password
 * is never taken from the command line: it comes from `ALEO_ACCOUNT_PASSWORD`,
 * the macOS Keychain or a hidden prompt.
 *
 * Results go to standard output; notes, prompts and errors go to standard
 * error as `<CODE>: <message>`. With `--json`, a result is one object with
 * `name`, `address`, `storage` and `path`, and an error is
 * `{"error":{"code":…,"message":…}}` on standard output. A private key appears
 * only in the output of `export` and of `create --storage none`, a recovery
 * phrase only in the output of `create --mnemonic`, and neither with `--json`.
 *
 * Exit codes: 0 done · 1 failed · 2 needs a person (no account, no stored key,
 * no password, no terminal) · 64 usage error.
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

const USAGE = `shield-swap account — store an Aleo account on this machine and inspect it

Usage: shield-swap account <command> [options]

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

const EXIT_DONE = 0
const EXIT_FAILED = 1
const EXIT_NEEDS_PERSON = 2
const EXIT_USAGE = 64

/** Failures a person has to resolve: an agent or a script stops and asks. */
const NEEDS_PERSON = new Set(['ACCOUNT_NOT_FOUND', 'KEY_NOT_STORED', 'PASSWORD_REQUIRED', 'TERMINAL_REQUIRED'])

/** Variables that supply a key to import, as the keystore reads them. */
const KEY_VARIABLES = [
  'ALEO_PRIVATE_KEY',
  'SHIELD_SWAP_PRIVATE_KEY',
  'ALEO_PRIVATE_KEY_FILE',
  'SHIELD_SWAP_PRIVATE_KEY_FILE',
] as const

const KEY_PREFIX = 'APrivateKey1'
const MAX_INDEX = 2 ** 31 - 1
const COMMANDS = ['create', 'import', 'show', 'protect', 'export', 'migrate'] as const
type CommandName = (typeof COMMANDS)[number]

/** Every flag any account command takes, in `parseArgs` option form. */
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

/** Flags every account command accepts. */
const COMMON_FLAGS = ['name', 'dir', 'json', 'help', 'no-color']

/** The flags each command accepts on top of the common ones. */
const COMMAND_FLAGS: Record<CommandName, readonly string[]> = {
  create: ['storage', 'save-password', 'mnemonic'],
  import: ['storage', 'save-password', 'key-file', 'mnemonic-file', 'index', 'derivation'],
  show: [],
  protect: ['storage', 'save-password', 'forget-password'],
  export: [],
  migrate: ['storage', 'save-password', 'from', 'remove-legacy-key', 'network'],
}

/** The storage types each command accepts. */
const COMMAND_STORAGE: Partial<Record<CommandName, readonly AccountStorage[]>> = {
  create: ['plaintext', 'keychain', 'encrypted', 'none'],
  import: ['plaintext', 'keychain', 'encrypted', 'none'],
  protect: ['plaintext', 'keychain', 'encrypted'],
  migrate: ['plaintext', 'keychain', 'encrypted'],
}

/**
 * One parsed `shield-swap account` invocation.
 *
 * @property command The account command.
 * @property name `--name`: the account name, when given.
 * @property dir `--dir`: the accounts directory, when given.
 * @property json Whether `--json` was given.
 * @property storage `--storage`, when given.
 * @property savePassword Whether `--save-password` was given.
 * @property forgetPassword Whether `--forget-password` was given.
 * @property mnemonic Whether `--mnemonic` was given.
 * @property keyFile `--key-file`, when given.
 * @property mnemonicFile `--mnemonic-file`, when given.
 * @property index `--index`: the account index of a recovery phrase. 0 unless
 *   given; a whole number from 0 through 2^31 - 1.
 * @property derivation `--derivation`: the path convention of a recovery
 *   phrase. `'standard'` unless given.
 * @property from `--from`, when given.
 * @property removeLegacyKey Whether `--remove-legacy-key` was given.
 * @property network `--network`, when given.
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
 * Reports a malformed invocation on standard error and exits 64.
 *
 * @param message What is wrong with the invocation.
 */
function usageError(message: string): never {
  console.error(`${red(message, 'stderr')}\n\n${help(USAGE)}`)
  process.exit(EXIT_USAGE)
}

/**
 * Parses and validates the arguments of an account command.
 *
 * The common flags may come before or after the command name. A flag that
 * belongs to another account command is rejected, so a mistyped invocation
 * never runs with a silently dropped option.
 *
 * @param argv Arguments after `shield-swap account`.
 * @returns The parsed invocation, or `undefined` when `--help` was asked for.
 */
function parse(argv: string[]): Args | undefined {
  let values: Record<string, string | boolean | undefined>
  let positionals: string[]
  // Only the parse is guarded: a wider try would report later failures as
  // usage errors.
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

/** Prints one line on standard output. */
function out(text: string): void {
  console.log(text)
}

/**
 * Prints the outcome of a command that leaves an account file in place.
 *
 * @param stored The account as stored.
 * @param json Whether `--json` was given: the outcome is then one object with
 *   `name`, `address`, `storage` and `path`, in that order.
 * @param sentence The outcome for a person.
 */
function report(stored: StoredAccount, json: boolean, sentence: string): void {
  out(
    json
      ? JSON.stringify({ name: stored.name, address: stored.address, storage: stored.storage, path: stored.path })
      : sentence,
  )
}

/** Words the outcome of a command that stored an account. */
function summary(stored: StoredAccount, verb: string): string {
  return `${verb} Aleo account ${stored.name} (${stored.address}) with ${stored.storage} storage in ${stored.path}.`
}

/**
 * Stops a command that shows a secret unless a person is at a terminal.
 *
 * @param what The command, as the person typed it.
 * @param json Whether `--json` was given.
 * @param secret What the command shows, named in the message.
 * @throws KeystoreError `TERMINAL_REQUIRED` when `--json` was given, or when
 *   standard input, output or error is not a terminal.
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
 * Tells the person what the chosen storage does not do on this system.
 *
 * @param stored The account as stored.
 * @param savePassword Whether `--save-password` was given.
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
 * Names the account file a command refers to, for a message.
 *
 * Follows the keystore's own order: `--name`, then `ALEO_ACCOUNT`, then
 * `default`; `--dir`, then `ALEO_ACCOUNTS_DIR`, then `~/.aleo/accounts`, with
 * a leading `~` expanded. Reads the environment and does not touch the disk.
 *
 * @param args The parsed invocation.
 * @returns The absolute path of the account file.
 */
function accountFilePath(args: Pick<Args, 'name' | 'dir'>): string {
  const home = homedir()
  let dir = args.dir || process.env.ALEO_ACCOUNTS_DIR || join(home, '.aleo', 'accounts')
  if (dir === '~') dir = home
  else if (dir.startsWith('~/') || (terminal.platform === 'win32' && dir.startsWith('~\\'))) dir = join(home, dir.slice(2))
  return join(resolve(dir), `${args.name ?? (process.env.ALEO_ACCOUNT || 'default')}.json`)
}

/**
 * Describes the selected account file, failing when there is none.
 *
 * @param args The parsed invocation.
 * @returns The account's name, path, address and storage type.
 * @throws KeystoreError `ACCOUNT_NOT_FOUND` when no account file exists, plus
 *   the failures of reading one.
 */
async function existingAccount(args: Args): Promise<StoredAccount> {
  const stored = await accountInfo({ name: args.name, dir: args.dir })
  if (!stored) throw new KeystoreError('ACCOUNT_NOT_FOUND', `There is no account file at ${accountFilePath(args)}.`)
  return stored
}

/**
 * Reads a text file that holds only a key or a recovery phrase.
 *
 * @param path Path of the file. Not expanded.
 * @param origin Phrase naming the file in messages.
 * @returns The content with surrounding white space, and a byte-order mark,
 *   removed.
 * @throws KeystoreError `EMPTY_KEY_SOURCE` when the file cannot be read or
 *   holds nothing.
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
 * Derives the account of a recovery phrase after tidying it.
 *
 * The phrase is trimmed, runs of white space are collapsed to single spaces
 * and letters are lower-cased before it is checked against the BIP-39 English
 * word list, word count and checksum.
 *
 * @param text Phrase as typed or pasted.
 * @param index Account index, from 0 through 2^31 - 1.
 * @param derivation Path convention: `'standard'` or `'legacy'`.
 * @returns The address and private key of the derived account.
 * @throws KeystoreError `INVALID_MNEMONIC` when the phrase is not valid. The
 *   message never repeats a word of the phrase.
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
  // Keys do not depend on the network; the handle only supplies the derivation.
  const aleo = await loadNetwork('testnet')
  const { address, privateKey } = aleo.mnemonicToAccount(phrase, { index, derivation })
  return { address, privateKey }
}

/**
 * Reads the key supplied through the key variables.
 *
 * Goes through the keystore's own lookup, so the variables follow its rules:
 * an empty one is an error, and two that hold different keys are an error.
 *
 * @param args The parsed invocation.
 * @returns The address and private key the variables supply.
 * @throws KeystoreError `EMPTY_KEY_SOURCE`, `INVALID_KEY` or `KEY_CONFLICT`
 *   for unusable variables, and `ACCOUNT_EXISTS` when the selected account
 *   file already holds another account.
 */
async function accountFromEnvironment(args: Args): Promise<{ address: string; privateKey: string }> {
  try {
    // A key in the environment is found before the account file is opened, so
    // no stored key is read and no password is asked for.
    const { account } = await loadAccount({ name: args.name, dir: args.dir, prompt: false })
    return { address: account.address, privateKey: account.privateKey }
  } catch (error) {
    if (!(error instanceof KeystoreError) || error.code !== 'ADDRESS_MISMATCH') throw error
    // The lookup reports a key that differs from the account file as a
    // mismatch. For an import that is a refusal to replace the file.
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
 * Finds the account to import: a file flag, the key variables, then a prompt.
 *
 * @param args The parsed invocation.
 * @returns The address and private key to store.
 * @throws KeystoreError `ACCOUNT_NOT_FOUND` when nothing supplies a key and no
 *   terminal is attached, `EMPTY_KEY_SOURCE` when a source is empty, and
 *   `INVALID_KEY` or `INVALID_MNEMONIC` for unusable input.
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
  // Text that starts like a key is a key; anything else is taken as a phrase.
  if (typed.startsWith(KEY_PREFIX)) return accountOfKey(typed, 'The key entered at the prompt')
  return accountOfPhrase(typed, args.index, args.derivation)
}

/** Generates a key, stores it and prints what a person must keep. */
async function create(args: Args): Promise<number> {
  const storage = args.storage ?? 'plaintext'
  // A phrase, or a key that is stored nowhere, is shown once, so a person must
  // be there to receive it. Checked before anything is generated or written.
  if (args.mnemonic) requireTerminal('create --mnemonic', args.json, 'the recovery phrase')
  if (storage === 'none') requireTerminal('create --storage none', args.json)

  let phrase: string | undefined
  let account: { address: string; privateKey: string }
  if (args.mnemonic) {
    // Twelve words, and the first account on the standard path: what a wallet
    // derives when the phrase is imported there.
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

  // Secrets are printed only after the account is stored, so a refused save
  // shows nothing.
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

/** Stores an existing key, or the account of a recovery phrase. */
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

/** Prints the address, account name and storage type. */
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
 * Reports whether a file holds a plaintext key of an address.
 *
 * Reads the file only. A file that is absent, unreadable, not JSON or holds no
 * key of the address counts as not holding one.
 *
 * @param path JSON file with a top-level `privateKey` or `private_key` field.
 * @param address Address to look for.
 * @returns True when one of the fields holds a key that derives the address.
 */
function holdsKeyOf(path: string, address: string): boolean {
  try {
    const content = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> | null
    for (const field of ['privateKey', 'private_key']) {
      const key = content?.[field]
      if (typeof key === 'string' && key && privateKeyToAccount(key).address === address) return true
    }
  } catch {
    // Absent, unreadable, not JSON or not a key: no copy to warn about.
  }
  return false
}

/**
 * Warns when a plaintext copy of an account's key remains in legacy state.
 *
 * Checks the state files of the current Shield Swap state directory and the
 * profile of the default Python SDK home (`~/.shield-swap/profile.json`).
 * State kept in other directories is not seen.
 *
 * @param stored The account as stored after a change of storage.
 * @param args The parsed invocation, repeated in the suggested command.
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

/** Changes how the key is stored, or removes a saved password. */
async function protect(args: Args): Promise<number> {
  const storage = args.storage
  if (storage === undefined) {
    // --forget-password alone. A saved password belongs to an encrypted
    // account on macOS; anything else has none to remove.
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
    // The keystore drops a saved password by encrypting the account again
    // without saving one. The password stays the same, so the person supplies
    // the current one: the variable, or a hidden prompt at a terminal.
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
  // The parser admits no other storage for this command.
  if (storage === 'none') throw new KeystoreError('UNSUPPORTED_STORAGE', 'An account cannot be moved to "none" storage.')
  const stored = await protectAccount({ name: args.name, dir: args.dir, storage, savePassword: args.savePassword })
  report(stored, args.json, summary(stored, 'Stored'))
  storageNotes(stored, args.savePassword)
  // Keychain or encrypted storage gives nothing while the key is still
  // readable in another tool's state file.
  if (stored.storage === 'keychain' || stored.storage === 'encrypted') warnLegacyCopies(stored, args)
  return EXIT_DONE
}

/** Prints the private key for a person who confirms at a terminal. */
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

/** Resolves a path through symbolic links, or lexically when it does not exist. */
function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Records the account in a Shield Swap state file.
 *
 * Later runs then read the key from that account file. The address is added
 * when the file lacks one: an older state could hold a key alone, and once the
 * key is stripped the address is what marks the state as set up. The other
 * fields are kept, and the file is rewritten atomically at mode 0600.
 *
 * @param path Path of the state file.
 * @param account Name and address of the account file that now holds the key.
 */
async function recordAccount(path: string, account: { name: string; address: string }): Promise<void> {
  const state = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  if (state.account === account.name && state.address) return
  state.account = account.name
  state.address ||= account.address
  writeStateFile(path, state)
}

/**
 * Names the state file `migrate` reads when no `--from` is given.
 *
 * @param network `--network`, when given. Defaults to `SHIELD_SWAP_NETWORK`,
 *   then testnet.
 * @returns The state file the network's session is read from, or the path it
 *   would have when the network has no state yet.
 */
function ownStatePath(network: string | undefined): string {
  const selected = resolveNetwork(network)
  return existingStatePath(selected) ?? statePath(selected)
}

/** Copies a legacy key into an account file. */
async function migrate(args: Args): Promise<number> {
  // Without --from, the file is this command line's own state for the network.
  const from = args.from ?? ownStatePath(args.network)
  const { legacyKeyRemoved, ...stored } = await migrateAccount({
    from,
    name: args.name,
    dir: args.dir,
    storage: args.storage ?? 'plaintext',
    savePassword: args.savePassword,
    removeLegacyKey: args.removeLegacyKey,
  })
  // A state file of this command line also records which account file now
  // holds its key, so later runs select it.
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

const HANDLERS: Record<CommandName, (args: Args) => Promise<number>> = {
  create,
  import: importAccount,
  show,
  protect,
  export: exportKey,
  migrate,
}

/**
 * Runs one `shield-swap account` command and reports its outcome.
 *
 * Reads and writes account files, and depending on the storage runs the macOS
 * `security` tool or asks for a password on the terminal. Does not contact a
 * network. The exit status is left in `process.exitCode`: 0 when done, 1 when
 * the command failed and 2 when it needs a person (`ACCOUNT_NOT_FOUND`,
 * `KEY_NOT_STORED`, `PASSWORD_REQUIRED` or `TERMINAL_REQUIRED`).
 *
 * @param argv Arguments after `shield-swap account`, as the dispatcher
 *   supplies them.
 * @returns Resolves after the outcome is printed. A usage error prints the
 *   usage on standard error and exits the process with status 64.
 *
 * @example
 * await main(['show', '--name', 'testnet', '--json'])
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
    // Anything else is a failure of the system underneath, such as a file
    // that cannot be read: one line, no stack.
    terminal.notify(`shield-swap account: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = EXIT_FAILED
  }
}
