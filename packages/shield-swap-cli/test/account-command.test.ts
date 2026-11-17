import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OTHER_PASSWORD, PASSWORD, mode, openSandbox, posix, type Outcome, type Sandbox } from './account-sandbox.js'

/**
 * Tests account commands, arguments, output, and exit codes.
 *
 * Uses temporary account files and the environment, Keychain, and terminal
 * replacements in `account-sandbox.ts`. Captures secret output and compares
 * keys and phrases with boolean assertions to keep them out of failure logs.
 */

vi.setConfig({ testTimeout: 60_000 })

const here = dirname(fileURLToPath(import.meta.url))
// Use the keystore's shared BIP-39 phrase and expected account derivations.
const vectors = JSON.parse(
  readFileSync(join(here, '../../provable-sdk/test/fixtures/keystore-vectors/vectors.json'), 'utf8'),
) as {
  mnemonic: {
    phrase: string
    accounts: Array<{ derivation: 'standard' | 'legacy'; index: number; privateKey: string; address: string }>
  }
}
const PHRASE = vectors.mnemonic.phrase

let sandbox: Sandbox
let main: (argv: string[]) => Promise<void>

beforeEach(async () => {
  sandbox = await openSandbox()
  ;({ main } = await import('../src/commands/account.js'))
})

afterEach(() => {
  sandbox.close()
})

/** Runs an account command and captures its output and exit code. */
function account(...argv: string[]): Promise<Outcome> {
  return sandbox.run(main, argv)
}

function newAccount(): { address: string; privateKey: string } {
  return sandbox.sdk.generateAccount()
}

/** Reads a stored test key without prompting for a password. */
function storedKey(name = 'default', password?: string): Promise<string> {
  return sandbox.keystore.exportAccount({ dir: sandbox.dir, name, password, prompt: false })
}

/** Checks for secret text without exposing it in assertion output. */
function shows(text: string, secret: string): boolean {
  return text.includes(secret)
}

function accountFile(name = 'default'): string {
  return join(sandbox.dir, `${name}.json`)
}

/** Finds the mock Keychain entry identifier recorded in an account file. */
function keyEntry(path: string): string {
  return `aleo-account-key ${(JSON.parse(readFileSync(path, 'utf8')) as { key: { account: string } }).key.account}`
}

/** Builds the mock Keychain entry identifier for an account's saved password. */
function savedPasswordEntry(path: string): string {
  const file = JSON.parse(readFileSync(path, 'utf8')) as { address: string; key: { kdfParams: { salt: string } } }
  return `aleo-account-password ${file.address}-${Buffer.from(file.key.kdfParams.salt, 'base64').toString('hex')}`
}

/** Extracts the recovery phrase from captured command output. */
function phraseShown(out: string): string {
  const lines = out.split('\n').filter((line) => line.startsWith('Recovery phrase: '))
  expect(lines).toHaveLength(1)
  return lines[0]!.slice('Recovery phrase: '.length)
}

/** Extracts private keys from captured command output. */
function keysShown(out: string): string[] {
  return out.split(/\s+/).filter((word) => word.startsWith('APrivateKey1'))
}

async function accountOfPhrase(phrase: string, options?: { index?: number; derivation?: 'standard' | 'legacy' }) {
  return (await sandbox.sdk.loadNetwork('testnet')).mnemonicToAccount(phrase, options)
}

describe('usage', () => {
  it.each([
    ['no command', []],
    ['an unknown command', ['destroy']],
    ['an unknown flag', ['show', '--verbose']],
    ['an abbreviated flag', ['show', '--nam', 'x']],
    ['a stray argument', ['show', 'extra']],
    ['an unknown storage', ['create', '--storage', 'vault']],
    ['a password on the command line', ['create', '--password', 'x']],
    ['protect without a storage', ['protect']],
    ['protect to none', ['protect', '--storage', 'none']],
    ['protect saving a password without a storage', ['protect', '--save-password']],
    ['save and forget', ['protect', '--storage', 'encrypted', '--save-password', '--forget-password']],
    ['migrate to none', ['migrate', '--from', 'x.json', '--storage', 'none']],
    ['a key file and a phrase file', ['import', '--key-file', 'a', '--mnemonic-file', 'b']],
    ['a negative index', ['import', '--index', '-1']],
    ['an index beyond 2^31 - 1', ['import', '--index', '2147483648']],
    ['an index that is not a number', ['import', '--index', 'one']],
    ['an unknown derivation', ['import', '--derivation', 'bip44']],
    ['a flag of another command', ['show', '--forget-password']],
    ['a storage on export', ['export', '--storage', 'plaintext']],
    ['a network on a command that reads no state', ['show', '--network', 'mainnet']],
    ['an unknown network', ['migrate', '--network', 'devnet']],
    ['a flag without its value', ['create', '--name']],
    ['a usage error with --json', ['show', '--verbose', '--json']],
  ])('exits 64 for %s', async (_label, argv) => {
    const outcome = await account(...argv)
    expect(outcome.status).toBe(64)
    expect(outcome.out).toBe('')
    expect(outcome.err).toContain('Usage:')
    expect(existsSync(sandbox.dir)).toBe(false)
  })

  it('prints the usage and exits 0 for --help', async () => {
    for (const argv of [['--help'], ['-h'], ['import', '--help']]) {
      const outcome = await account(...argv)
      expect(outcome.status).toBe(0)
      for (const command of ['create', 'import', 'show', 'protect', 'export', 'migrate']) {
        expect(outcome.out).toContain(command)
      }
    }
  })

  it('accepts the common flags before and after the command', async () => {
    await sandbox.keystore.saveAccount(newAccount(), { dir: sandbox.dir, name: 'named' })
    const after = await account('show', '--name', 'named', '--json')
    const before = await account('--json', '--name', 'named', '--dir', sandbox.dir, 'show')
    expect(after.status).toBe(0)
    expect(before.status).toBe(0)
    expect(after.json).toEqual(before.json)
    expect(after.json.name).toBe('named')
  })

  it('is listed by the dispatcher', async () => {
    const { COMMANDS } = await import('../src/registry.js')
    expect(COMMANDS.account).toBeDefined()
    expect((await COMMANDS.account!.load()).main).toBe(main)
  })
})

describe('output and exit status', () => {
  it('show prints the account and never the key', async () => {
    const owner = newAccount()
    const stored = await sandbox.keystore.saveAccount(owner, { dir: sandbox.dir })

    const outcome = await account('show', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.err).toBe('')
    expect(outcome.out.includes('\n')).toBe(false)
    expect(outcome.json).toEqual({ name: 'default', address: owner.address, storage: 'plaintext', path: stored.path })
    expect(Object.keys(outcome.json)).toEqual(['name', 'address', 'storage', 'path'])

    const plain = await account('show')
    expect(plain.status).toBe(0)
    for (const value of ['default', owner.address, 'plaintext', stored.path]) expect(plain.out).toContain(value)
    expect(shows(plain.out + plain.err + outcome.out, owner.privateKey)).toBe(false)
  })

  it('show reads only the account file', async () => {
    await sandbox.keystore.saveAccount(newAccount(), { dir: sandbox.dir, storage: 'encrypted', password: PASSWORD })
    process.env.ALEO_PRIVATE_KEY = ''
    const outcome = await account('show', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json.storage).toBe('encrypted')
    expect(sandbox.security.calls).toEqual([])
    expect(sandbox.prompts).toEqual([])
  })

  it('reports errors on standard error as code and message', async () => {
    const outcome = await account('show')
    expect(outcome.status).toBe(2)
    expect(outcome.out).toBe('')
    expect(outcome.err.startsWith('ACCOUNT_NOT_FOUND: ')).toBe(true)
    expect(outcome.err).toContain(accountFile())
  })

  it('reports errors on standard output as JSON with --json', async () => {
    const outcome = await account('show', '--json')
    expect(outcome.status).toBe(2)
    expect(outcome.err).toBe('')
    expect(outcome.out.includes('\n')).toBe(false)
    expect(Object.keys(outcome.json)).toEqual(['error'])
    expect(Object.keys(outcome.json.error)).toEqual(['code', 'message'])
    expect(outcome.json.error.code).toBe('ACCOUNT_NOT_FOUND')
    expect(outcome.json.error.message).toContain(accountFile())
  })

  it('names the account file the keystore would read in a not-found message', async () => {
    process.env.ALEO_ACCOUNT = 'from-env'
    expect((await account('show', '--json')).json.error.message).toContain(join(sandbox.dir, 'from-env.json'))
    delete process.env.ALEO_ACCOUNTS_DIR
    expect((await account('show', '--name', 'other', '--json')).json.error.message).toContain(
      join(sandbox.home, '.aleo', 'accounts', 'other.json'),
    )
    expect((await account('show', '--dir', '~/elsewhere', '--json')).json.error.message).toContain(
      join(sandbox.home, 'elsewhere', 'from-env.json'),
    )
  })

  it('exits 2 when a person is needed and 1 for other failures', async () => {
    const owner = newAccount()
    // A missing account requires configuration.
    expect((await account('show')).status).toBe(2)
    // An address-only account requires an external key.
    await sandbox.keystore.saveAccount(owner, { dir: sandbox.dir, name: 'address-only', storage: 'none' })
    let outcome = await account('protect', '--storage', 'plaintext', '--name', 'address-only', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([2, 'KEY_NOT_STORED'])
    // Encrypted storage requires a password source.
    outcome = await account('create', '--storage', 'encrypted', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([2, 'PASSWORD_REQUIRED'])
    // Key export requires terminal input and output.
    outcome = await account('export', '--name', 'address-only')
    expect(outcome.status).toBe(2)
    expect(outcome.err.startsWith('TERMINAL_REQUIRED: ')).toBe(true)
    // Other keystore errors use exit code 1.
    await sandbox.keystore.saveAccount(owner, { dir: sandbox.dir })
    outcome = await account('create', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([1, 'ACCOUNT_EXISTS'])
    outcome = await account('show', '--name', 'Not_Valid', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([1, 'INVALID_NAME'])
    await sandbox.keystore.saveAccount(owner, { dir: sandbox.dir, name: 'locked', storage: 'encrypted', password: PASSWORD })
    process.env.ALEO_ACCOUNT_PASSWORD = OTHER_PASSWORD
    outcome = await account('protect', '--storage', 'plaintext', '--name', 'locked', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([1, 'WRONG_PASSWORD'])
    expect(shows(outcome.out + outcome.err, OTHER_PASSWORD)).toBe(false)
  })

  it('exits 1 for a file system failure', async () => {
    mkdirSync(accountFile(), { recursive: true })
    const outcome = await account('show')
    expect(outcome.status).toBe(1)
    expect(outcome.out).toBe('')
    expect(outcome.err.startsWith('shield-swap account: ')).toBe(true)
  })
})

describe('create', () => {
  it('generates a key and stores it in plaintext by default', async () => {
    const outcome = await account('create', '--json')
    expect(outcome.status).toBe(0)
    expect(Object.keys(outcome.json)).toEqual(['name', 'address', 'storage', 'path'])
    expect(outcome.json).toMatchObject({ name: 'default', storage: 'plaintext', path: accountFile() })
    const key = await storedKey()
    expect(sandbox.sdk.privateKeyToAccount(key).address).toBe(outcome.json.address)
    expect(shows(outcome.out + outcome.err, key)).toBe(false)
    if (posix) {
      expect(mode(accountFile())).toBe(0o600)
      expect(mode(sandbox.dir)).toBe(0o700)
    }

    // A distinct account name creates an independent key.
    const other = await account('create', '--name', 'second')
    expect(other.status).toBe(0)
    expect(other.out).toContain('second')
    expect((await storedKey('second')) === key).toBe(false)
    expect(shows(other.out + other.err, await storedKey('second'))).toBe(false)
  })

  it('refuses to replace an existing account', async () => {
    expect((await account('create')).status).toBe(0)
    const before = readFileSync(accountFile())
    const outcome = await account('create')
    expect(outcome.status).toBe(1)
    expect(outcome.err.startsWith('ACCOUNT_EXISTS: ')).toBe(true)
    expect(readFileSync(accountFile()).equals(before)).toBe(true)
  })

  it('takes the name and the directory from the variables', async () => {
    process.env.ALEO_ACCOUNT = 'from-env'
    process.env.ALEO_ACCOUNTS_DIR = join(sandbox.root, 'env-dir')
    const outcome = await account('create', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json.path).toBe(join(sandbox.root, 'env-dir', 'from-env.json'))
  })

  it('needs a terminal to create an account without a stored key, and shows the key once', async () => {
    // Reject secret output before creating files when no terminal is attached.
    let outcome = await account('create', '--storage', 'none')
    expect(outcome.status).toBe(2)
    expect(outcome.err.startsWith('TERMINAL_REQUIRED: ')).toBe(true)
    expect(keysShown(outcome.out + outcome.err)).toEqual([])
    expect(existsSync(sandbox.dir)).toBe(false)

    // Reject private key output redirected to a pipe or file.
    sandbox.flags.terminal = true
    expect((await account('create', '--storage', 'none')).status).toBe(2)
    expect(existsSync(sandbox.dir)).toBe(false)

    // Reject JSON private key output even with a terminal attached.
    sandbox.flags.outputTerminal = true
    outcome = await account('create', '--storage', 'none', '--json')
    expect(outcome.status).toBe(2)
    expect(outcome.json.error.code).toBe('TERMINAL_REQUIRED')
    expect(existsSync(sandbox.dir)).toBe(false)

    outcome = await account('create', '--storage', 'none')
    expect(outcome.status).toBe(0)
    const shown = keysShown(outcome.out)
    expect(shown).toHaveLength(1)
    expect(keysShown(outcome.err)).toEqual([])
    const stored = await sandbox.keystore.accountInfo({ dir: sandbox.dir })
    expect(stored?.storage).toBe('none')
    expect(sandbox.sdk.privateKeyToAccount(shown[0]!).address === stored?.address).toBe(true)
    expect(shows(readFileSync(accountFile(), 'utf8'), shown[0]!)).toBe(false)
    expect(outcome.err).toContain('ALEO_PRIVATE_KEY')
  })

  it('needs a terminal to create an account from a new phrase, and shows the phrase once', async () => {
    // Reject secret output before creating files when no terminal is attached.
    let outcome = await account('create', '--mnemonic')
    expect(outcome.status).toBe(2)
    expect(outcome.err.startsWith('TERMINAL_REQUIRED: ')).toBe(true)
    expect(outcome.err).toContain('recovery phrase')
    expect((outcome.out + outcome.err).includes('Recovery phrase:')).toBe(false)
    expect(existsSync(sandbox.dir)).toBe(false)

    // Reject recovery phrase output redirected to a pipe or file.
    sandbox.flags.terminal = true
    expect((await account('create', '--mnemonic')).status).toBe(2)
    expect(existsSync(sandbox.dir)).toBe(false)

    // Reject JSON recovery phrase output even with a terminal attached.
    sandbox.flags.outputTerminal = true
    outcome = await account('create', '--mnemonic', '--json')
    expect(outcome.status).toBe(2)
    expect(outcome.json.error.code).toBe('TERMINAL_REQUIRED')
    expect(existsSync(sandbox.dir)).toBe(false)

    outcome = await account('create', '--mnemonic')
    expect(outcome.status).toBe(0)
    const phrase = phraseShown(outcome.out)
    expect(phrase.split(' ')).toHaveLength(12)
    expect(outcome.err.includes('Recovery phrase:')).toBe(false)
    expect(outcome.err).toContain('stored nowhere')
    // Print the recovery phrase without also printing the stored private key.
    expect(keysShown(outcome.out + outcome.err)).toEqual([])

    // Derive account 0 on the standard Aleo path from the displayed phrase.
    const stored = await sandbox.keystore.accountInfo({ dir: sandbox.dir })
    expect(stored?.storage).toBe('plaintext')
    const derived = await accountOfPhrase(phrase)
    expect(derived.address === stored?.address).toBe(true)
    expect(derived.privateKey === (await storedKey())).toBe(true)
    // Keep the recovery phrase out of files in the test directory.
    for (const file of readdirSync(sandbox.dir)) {
      const text = readFileSync(join(sandbox.dir, file), 'utf8')
      expect(shows(text, phrase)).toBe(false)
      for (const word of phrase.split(' ').slice(0, 3)) expect(shows(text, ` ${word} `)).toBe(false)
    }
  })

  it('makes a different account from each new phrase', async () => {
    sandbox.flags.terminal = sandbox.flags.outputTerminal = true
    const first = await account('create', '--mnemonic', '--name', 'one')
    const second = await account('create', '--mnemonic', '--name', 'two')
    expect([first.status, second.status]).toEqual([0, 0])
    expect(phraseShown(first.out) === phraseShown(second.out)).toBe(false)
    const one = await sandbox.keystore.accountInfo({ dir: sandbox.dir, name: 'one' })
    const two = await sandbox.keystore.accountInfo({ dir: sandbox.dir, name: 'two' })
    expect(one?.address === two?.address).toBe(false)
  })

  it('shows no phrase when the account cannot be stored', async () => {
    sandbox.flags.terminal = sandbox.flags.outputTerminal = true
    expect((await account('create')).status).toBe(0)
    const before = readFileSync(accountFile())
    const outcome = await account('create', '--mnemonic')
    expect(outcome.status).toBe(1)
    expect(outcome.err.startsWith('ACCOUNT_EXISTS: ')).toBe(true)
    expect((outcome.out + outcome.err).includes('Recovery phrase:')).toBe(false)
    expect(readFileSync(accountFile()).equals(before)).toBe(true)
  })

  it('names the phrase as the backup of a Keychain account made from one', async () => {
    sandbox.flags.terminal = sandbox.flags.outputTerminal = true
    const outcome = await account('create', '--mnemonic', '--storage', 'keychain', '--name', 'wallet')
    expect(outcome.status).toBe(0)
    const phrase = phraseShown(outcome.out)
    const stored = await sandbox.keystore.accountInfo({ dir: sandbox.dir, name: 'wallet' })
    expect(stored?.storage).toBe('keychain')
    const key = sandbox.security.entries.get(keyEntry(stored!.path))!
    expect((await accountOfPhrase(phrase)).privateKey === key).toBe(true)
    expect(shows(outcome.out + outcome.err, key)).toBe(false)
    // Show the export reminder only when no recovery phrase was generated.
    expect(outcome.err.includes('export')).toBe(false)
  })

  it('shows the phrase and the key of a phrase account with no stored key', async () => {
    sandbox.flags.terminal = sandbox.flags.outputTerminal = true
    const outcome = await account('create', '--mnemonic', '--storage', 'none')
    expect(outcome.status).toBe(0)
    const shown = keysShown(outcome.out)
    expect(shown).toHaveLength(1)
    expect((await accountOfPhrase(phraseShown(outcome.out))).privateKey === shown[0]).toBe(true)
    expect((await sandbox.keystore.accountInfo({ dir: sandbox.dir }))?.storage).toBe('none')
  })

  it('says a Keychain account has no other copy of its key', async () => {
    const outcome = await account('create', '--storage', 'keychain', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json.storage).toBe('keychain')
    const key = sandbox.security.entries.get(keyEntry(outcome.json.path))!
    expect(key.startsWith('APrivateKey1')).toBe(true)
    expect(shows(outcome.out + outcome.err, key)).toBe(false)
    expect(readFileSync(accountFile(), 'utf8').includes('APrivateKey1')).toBe(false)
    expect(outcome.err).toContain('shield-swap account export')
    expect(outcome.err).toContain('Keychain')
  })

  it('fails Keychain storage outside macOS before anything is written', async () => {
    sandbox.runtime.platform = 'linux'
    const outcome = await account('create', '--storage', 'keychain')
    expect(outcome.status).toBe(1)
    expect(outcome.err.startsWith('KEYCHAIN_UNAVAILABLE: ')).toBe(true)
    expect(existsSync(sandbox.dir)).toBe(false)
    expect(sandbox.security.calls).toEqual([])
  })

  it('takes the password of an encrypted account from the variable or the prompt', async () => {
    // Report PASSWORD_REQUIRED when no password source is available.
    expect((await account('create', '--storage', 'encrypted')).status).toBe(2)
    expect(existsSync(sandbox.dir)).toBe(false)

    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    let outcome = await account('create', '--storage', 'encrypted', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json.storage).toBe('encrypted')
    expect(sandbox.security.calls).toEqual([])
    delete process.env.ALEO_ACCOUNT_PASSWORD
    const key = await storedKey('default', PASSWORD)
    expect(shows(outcome.out + outcome.err, key)).toBe(false)
    expect(shows(outcome.out + outcome.err, PASSWORD)).toBe(false)

    // Prompt for the password and confirmation.
    sandbox.flags.terminal = true
    sandbox.answers.push(OTHER_PASSWORD, OTHER_PASSWORD)
    outcome = await account('create', '--storage', 'encrypted', '--name', 'typed')
    expect(outcome.status).toBe(0)
    expect(sandbox.prompts).toHaveLength(2)
    expect(outcome.out).toContain(sandbox.sdk.privateKeyToAccount(await storedKey('typed', OTHER_PASSWORD)).address)
  })

  it('can save the password in the Keychain, and says when that does not apply', async () => {
    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    const outcome = await account('create', '--storage', 'encrypted', '--save-password', '--json')
    expect(outcome.status).toBe(0)
    expect([...sandbox.security.entries]).toEqual([
      [savedPasswordEntry(outcome.json.path), Buffer.from(PASSWORD, 'utf8').toString('hex')],
    ])
    expect(outcome.err.includes('--save-password')).toBe(false)

    // Report when --save-password does not apply to the selected storage.
    const plain = await account('create', '--name', 'plain', '--save-password')
    expect(plain.status).toBe(0)
    expect(plain.err).toContain('--save-password')
    sandbox.runtime.platform = 'linux'
    sandbox.terminal.platform = 'linux'
    const elsewhere = await account('create', '--name', 'elsewhere', '--storage', 'encrypted', '--save-password')
    expect(elsewhere.status).toBe(0)
    expect(elsewhere.err).toContain('--save-password')
    expect(sandbox.security.entries.size).toBe(1)
  })

  it('says that Windows does not enforce file modes when storing plaintext', async () => {
    sandbox.runtime.platform = 'win32'
    sandbox.terminal.platform = 'win32'
    const outcome = await account('create')
    expect(outcome.status).toBe(0)
    expect(outcome.err).toContain('Windows')
    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    const encrypted = await account('create', '--name', 'locked', '--storage', 'encrypted')
    expect(encrypted.status).toBe(0)
    expect(encrypted.err.includes('Windows')).toBe(false)
  })
})

describe('import', () => {
  it('stores the key of a key file', async () => {
    const owner = newAccount()
    const keyFile = join(sandbox.root, 'key.txt')
    writeFileSync(keyFile, `\n  ${owner.privateKey}\n`)
    // An explicit key file takes precedence over environment keys.
    process.env.ALEO_PRIVATE_KEY = ''
    const outcome = await account('import', '--key-file', keyFile, '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json).toEqual({ name: 'default', address: owner.address, storage: 'plaintext', path: accountFile() })
    expect((await storedKey()) === owner.privateKey).toBe(true)
    expect(shows(outcome.out + outcome.err, owner.privateKey)).toBe(false)

    // Repeated imports preserve the existing account file.
    expect((await account('import', '--key-file', keyFile)).status).toBe(0)
    // Reject a different key for an existing account name.
    writeFileSync(keyFile, newAccount().privateKey)
    const again = await account('import', '--key-file', keyFile, '--json')
    expect([again.status, again.json.error.code]).toEqual([1, 'ACCOUNT_EXISTS'])
  })

  it.each([
    ['missing', undefined, 'EMPTY_KEY_SOURCE'],
    ['blank', ' \n', 'EMPTY_KEY_SOURCE'],
    ['not a key', 'APrivateKey1nope', 'INVALID_KEY'],
  ])('reports an unusable key file (%s)', async (_label, content, code) => {
    const keyFile = join(sandbox.root, 'key.txt')
    if (content !== undefined) writeFileSync(keyFile, content)
    for (const flag of ['--key-file', '--mnemonic-file']) {
      const outcome = await account('import', flag, keyFile, '--json')
      const expected = flag === '--mnemonic-file' && code === 'INVALID_KEY' ? 'INVALID_MNEMONIC' : code
      expect([outcome.status, outcome.json.error.code]).toEqual([1, expected])
      expect(outcome.out.includes('nope')).toBe(false)
    }
    expect(existsSync(sandbox.dir)).toBe(false)
  })

  it('stores a key supplied through the variables', async () => {
    const owner = newAccount()
    process.env.SHIELD_SWAP_PRIVATE_KEY = owner.privateKey
    const outcome = await account('import', '--storage', 'keychain', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json.address).toBe(owner.address)
    expect(sandbox.security.entries.get(keyEntry(outcome.json.path)) === owner.privateKey).toBe(true)
    expect(shows(outcome.out + outcome.err, owner.privateKey)).toBe(false)

    const keyFile = join(sandbox.root, 'key.txt')
    writeFileSync(keyFile, owner.privateKey)
    delete process.env.SHIELD_SWAP_PRIVATE_KEY
    process.env.ALEO_PRIVATE_KEY_FILE = keyFile
    const fromFile = await account('import', '--name', 'from-file', '--json')
    expect(fromFile.status).toBe(0)
    expect((await storedKey('from-file')) === owner.privateKey).toBe(true)
  })

  it('applies the rules of the key variables', async () => {
    process.env.ALEO_PRIVATE_KEY = ''
    let outcome = await account('import', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([1, 'EMPTY_KEY_SOURCE'])
    process.env.ALEO_PRIVATE_KEY = newAccount().privateKey
    process.env.SHIELD_SWAP_PRIVATE_KEY = newAccount().privateKey
    outcome = await account('import', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([1, 'KEY_CONFLICT'])
    expect(existsSync(sandbox.dir)).toBe(false)
  })

  it('refuses a key from the variables when the account file holds another account', async () => {
    const existing = await sandbox.keystore.saveAccount(newAccount(), { dir: sandbox.dir })
    const before = readFileSync(existing.path)
    process.env.ALEO_PRIVATE_KEY = newAccount().privateKey
    const outcome = await account('import', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([1, 'ACCOUNT_EXISTS'])
    expect(readFileSync(existing.path).equals(before)).toBe(true)

    // A storage mismatch directs the caller to account protect.
    process.env.ALEO_PRIVATE_KEY = await storedKey()
    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    const other = await account('import', '--storage', 'encrypted', '--json')
    expect([other.status, other.json.error.code]).toEqual([1, 'ACCOUNT_EXISTS'])
    expect((await account('import', '--json')).status).toBe(0)
  })

  it.each(vectors.mnemonic.accounts.map((entry) => [`${entry.derivation}-${entry.index}`, entry] as const))(
    'stores the derived key of a recovery phrase file and not the phrase (%s)',
    async (_label, expected) => {
      const phraseFile = join(sandbox.root, 'phrase.txt')
      // Test normalization of uppercase words and repeated whitespace.
      writeFileSync(phraseFile, `  ${PHRASE.toUpperCase().replaceAll(' ', ' \n\t ')}\n\n`)
      const outcome = await account(
        'import', '--mnemonic-file', phraseFile,
        '--index', String(expected.index), '--derivation', expected.derivation, '--json',
      )
      expect(outcome.status).toBe(0)
      expect(outcome.json.address).toBe(expected.address)
      expect((await storedKey()) === expected.privateKey).toBe(true)
      const text = readFileSync(accountFile(), 'utf8')
      expect(text.includes('abandon') || text.includes('about')).toBe(false)
      expect((outcome.out + outcome.err).includes('abandon')).toBe(false)
    },
  )

  it('defaults to the first account on the standard path', async () => {
    const phraseFile = join(sandbox.root, 'phrase.txt')
    writeFileSync(phraseFile, PHRASE)
    const outcome = await account('import', '--mnemonic-file', phraseFile, '--json')
    const first = vectors.mnemonic.accounts.find((entry) => entry.derivation === 'standard' && entry.index === 0)!
    expect(outcome.json.address).toBe(first.address)
  })

  it('rejects an invalid recovery phrase', async () => {
    const phraseFile = join(sandbox.root, 'phrase.txt')
    const words = PHRASE.split(' ')
    for (const phrase of [
      [...words.slice(0, -1), 'abandon'].join(' '), // Invalid checksum.
      words.slice(0, -1).join(' '), // Invalid word count.
      [...words.slice(0, -1), 'zzzzzz'].join(' '), // Word outside the BIP-39 English list.
    ]) {
      writeFileSync(phraseFile, phrase)
      const outcome = await account('import', '--mnemonic-file', phraseFile, '--json')
      expect([outcome.status, outcome.json.error.code]).toEqual([1, 'INVALID_MNEMONIC'])
      expect(outcome.out.includes('abandon') || outcome.out.includes('zzzzzz')).toBe(false)
    }
    expect(existsSync(sandbox.dir)).toBe(false)
  })

  it('asks at a hidden prompt when nothing else supplies a key', async () => {
    // Report ACCOUNT_NOT_FOUND when no key source or prompt is available.
    let outcome = await account('import', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([2, 'ACCOUNT_NOT_FOUND'])
    expect(sandbox.prompts).toEqual([])

    sandbox.flags.terminal = true
    // Use private key validation for input with the APrivateKey1 prefix.
    const owner = newAccount()
    sandbox.answers.push(` ${owner.privateKey}\n`)
    outcome = await account('import', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json.address).toBe(owner.address)
    expect(sandbox.prompts).toHaveLength(1)
    expect(shows(outcome.out + outcome.err, owner.privateKey)).toBe(false)

    // Normalize and validate other input as a recovery phrase.
    const second = vectors.mnemonic.accounts.find((entry) => entry.derivation === 'legacy' && entry.index === 1)!
    const titled = PHRASE.split(' ').map((word) => word[0]!.toUpperCase() + word.slice(1)).join('   ')
    sandbox.answers.push(`  ${titled} `)
    outcome = await account('import', '--name', 'phrase', '--index', '1', '--derivation', 'legacy', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json.address).toBe(second.address)
    expect((await storedKey('phrase')) === second.privateKey).toBe(true)

    sandbox.answers.push('APrivateKey1nope')
    outcome = await account('import', '--name', 'bad-key', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([1, 'INVALID_KEY'])
    sandbox.answers.push('not a recovery phrase')
    outcome = await account('import', '--name', 'bad-phrase', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([1, 'INVALID_MNEMONIC'])
    // Reject whitespace-only input as an empty key source.
    sandbox.answers.push('   ')
    outcome = await account('import', '--name', 'nothing', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([1, 'EMPTY_KEY_SOURCE'])
  })

  it('can record the address only', async () => {
    const owner = newAccount()
    process.env.ALEO_PRIVATE_KEY = owner.privateKey
    const outcome = await account('import', '--storage', 'none', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json.storage).toBe('none')
    expect(shows(readFileSync(accountFile(), 'utf8'), owner.privateKey)).toBe(false)
    expect(shows(outcome.out + outcome.err, owner.privateKey)).toBe(false)
  })
})

describe('protect', () => {
  it('changes the storage', async () => {
    const owner = newAccount()
    await sandbox.keystore.saveAccount(owner, { dir: sandbox.dir })

    let outcome = await account('protect', '--storage', 'keychain', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json).toEqual({ name: 'default', address: owner.address, storage: 'keychain', path: accountFile() })

    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    outcome = await account('protect', '--storage', 'encrypted', '--save-password', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json.storage).toBe('encrypted')
    expect([...sandbox.security.entries]).toEqual([
      [savedPasswordEntry(outcome.json.path), Buffer.from(PASSWORD, 'utf8').toString('hex')],
    ])

    outcome = await account('protect', '--storage', 'plaintext')
    expect(outcome.status).toBe(0)
    expect(sandbox.security.entries.size).toBe(0)
    delete process.env.ALEO_ACCOUNT_PASSWORD
    expect((await storedKey()) === owner.privateKey).toBe(true)
    expect(shows(outcome.out + outcome.err, owner.privateKey)).toBe(false)
  })

  it('sets a new password on an encrypted account from the prompt only', async () => {
    const owner = newAccount()
    await sandbox.keystore.saveAccount(owner, { dir: sandbox.dir, storage: 'encrypted', password: PASSWORD })
    const before = readFileSync(accountFile())
    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD

    const outcome = await account('protect', '--storage', 'encrypted', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([2, 'PASSWORD_REQUIRED'])
    expect(readFileSync(accountFile()).equals(before)).toBe(true)

    sandbox.flags.terminal = true
    sandbox.answers.push(OTHER_PASSWORD, OTHER_PASSWORD)
    expect((await account('protect', '--storage', 'encrypted')).status).toBe(0)
    expect(readFileSync(accountFile()).equals(before)).toBe(false)
    delete process.env.ALEO_ACCOUNT_PASSWORD
    expect((await storedKey('default', OTHER_PASSWORD)) === owner.privateKey).toBe(true)
  })

  it('forgets a saved password and keeps the password itself', async () => {
    const owner = newAccount()
    await sandbox.keystore.saveAccount(owner, {
      dir: sandbox.dir, storage: 'encrypted', password: PASSWORD, savePassword: true,
    })
    const before = readFileSync(accountFile())
    expect(sandbox.security.entries.size).toBe(1)

    // Removing a saved password requires the current password.
    // Preserve the account and Keychain entry when it is unavailable.
    let outcome = await account('protect', '--forget-password', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([2, 'PASSWORD_REQUIRED'])
    expect(readFileSync(accountFile()).equals(before)).toBe(true)
    expect(sandbox.security.entries.size).toBe(1)

    // Preserve the account and Keychain entry when the password is incorrect.
    sandbox.flags.terminal = true
    sandbox.answers.push(OTHER_PASSWORD)
    outcome = await account('protect', '--forget-password', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([1, 'WRONG_PASSWORD'])
    expect(readFileSync(accountFile()).equals(before)).toBe(true)
    expect(sandbox.security.entries.size).toBe(1)

    // Remove the saved password while retaining it as the encryption password.
    sandbox.prompts.length = 0
    sandbox.answers.push(PASSWORD)
    outcome = await account('protect', '--forget-password', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json.storage).toBe('encrypted')
    expect(sandbox.prompts).toHaveLength(1)
    expect(sandbox.security.entries.size).toBe(0)
    expect(readFileSync(accountFile()).equals(before)).toBe(false)
    expect((await storedKey('default', PASSWORD)) === owner.privateKey).toBe(true)
    expect(shows(outcome.out + outcome.err, PASSWORD)).toBe(false)

    expect((await account('protect', '--forget-password', '--name', 'absent')).status).toBe(2)
  })

  it('takes the current password from the variable when forgetting a saved one', async () => {
    const owner = newAccount()
    await sandbox.keystore.saveAccount(owner, {
      dir: sandbox.dir, storage: 'encrypted', password: PASSWORD, savePassword: true,
    })
    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    const outcome = await account('protect', '--forget-password')
    delete process.env.ALEO_ACCOUNT_PASSWORD
    expect(outcome.status).toBe(0)
    expect(outcome.out).toContain('Removed the saved password')
    expect(sandbox.prompts).toHaveLength(0)
    expect(sandbox.security.entries.size).toBe(0)
    expect((await storedKey('default', PASSWORD)) === owner.privateKey).toBe(true)
  })

  it('leaves an account that is not encrypted as it is when asked to forget a password', async () => {
    await sandbox.keystore.saveAccount(newAccount(), { dir: sandbox.dir })
    const before = readFileSync(accountFile())
    const outcome = await account('protect', '--forget-password', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json.storage).toBe('plaintext')
    expect(readFileSync(accountFile()).equals(before)).toBe(true)
    expect(sandbox.security.calls).toEqual([])
  })

  it('removes the saved password when --forget-password comes with a storage change', async () => {
    await sandbox.keystore.saveAccount(newAccount(), {
      dir: sandbox.dir, storage: 'encrypted', password: PASSWORD, savePassword: true,
    })
    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    const outcome = await account('protect', '--storage', 'keychain', '--forget-password', '--json')
    expect(outcome.status).toBe(0)
    expect([...sandbox.security.entries.keys()]).toEqual([keyEntry(outcome.json.path)])
  })

  it('cannot forget a password outside macOS', async () => {
    await sandbox.keystore.saveAccount(newAccount(), { dir: sandbox.dir, storage: 'encrypted', password: PASSWORD })
    sandbox.runtime.platform = 'linux'
    sandbox.terminal.platform = 'linux'
    const outcome = await account('protect', '--forget-password', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([1, 'KEYCHAIN_UNAVAILABLE'])
    expect(sandbox.security.calls).toEqual([])
  })

  it('warns when a plaintext copy of the key remains in the state directory or the Python home', async () => {
    const owner = newAccount()
    await sandbox.keystore.saveAccount(owner, { dir: sandbox.dir })
    const state = join(sandbox.stateRoot, 'mainnet', 'state.json')
    const profile = join(sandbox.home, '.shield-swap', 'profile.json')
    const unrelated = join(sandbox.stateRoot, 'testnet', 'state.json')
    for (const [path, content] of [
      [state, { network: 'mainnet', privateKey: owner.privateKey, address: owner.address }],
      [profile, { address: owner.address, private_key: owner.privateKey, network: 'testnet' }],
      // Exclude keys belonging to other addresses from the warning.
      [unrelated, { network: 'testnet', privateKey: newAccount().privateKey }],
    ] as const) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(content, null, 2))
    }
    const before = [state, profile, unrelated].map((path) => readFileSync(path, 'utf8'))

    // Plaintext storage does not trigger the duplicate-key warning.
    expect((await account('protect', '--storage', 'plaintext')).err).toBe('')

    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    const outcome = await account('protect', '--storage', 'encrypted', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.err).toContain(state)
    expect(outcome.err).toContain(profile)
    expect(outcome.err.includes(unrelated)).toBe(false)
    expect(outcome.err).toContain('--storage encrypted --remove-legacy-key')
    expect(shows(outcome.out + outcome.err, owner.privateKey)).toBe(false)
    // Warning about plaintext copies must not modify the source files.
    expect([state, profile, unrelated].map((path) => readFileSync(path, 'utf8'))).toEqual(before)

    // The suggested migration removes the plaintext copy and preserves encryption.
    expect((await account('migrate', '--from', state, '--storage', 'encrypted', '--remove-legacy-key')).status).toBe(0)
    expect(JSON.parse(readFileSync(state, 'utf8')).privateKey).toBeUndefined()
    const again = await account('protect', '--storage', 'keychain')
    expect(again.err.includes(state)).toBe(false)
    expect(again.err).toContain(profile)
  })
})

describe('export', () => {
  it('prints the key only for a person who confirms', async () => {
    const owner = newAccount()
    await sandbox.keystore.saveAccount(owner, { dir: sandbox.dir })
    // Export must read the stored key even when an environment key is set.
    process.env.ALEO_PRIVATE_KEY = newAccount().privateKey

    // Reject export before prompting when no terminal is attached.
    let outcome = await account('export')
    expect(outcome.status).toBe(2)
    expect(outcome.err.startsWith('TERMINAL_REQUIRED: ')).toBe(true)
    expect(outcome.out).toBe('')
    sandbox.flags.terminal = true
    expect((await account('export')).status).toBe(2)
    sandbox.flags.outputTerminal = true
    outcome = await account('export', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([2, 'TERMINAL_REQUIRED'])
    expect(sandbox.prompts).toEqual([])

    // Responses other than y or yes must not reveal the key.
    for (const answer of ['n', '', 'maybe']) {
      sandbox.answers.push(answer)
      outcome = await account('export')
      expect(outcome.status).toBe(1)
      expect(outcome.out).toBe('')
      expect(shows(outcome.err, owner.privateKey)).toBe(false)
    }

    sandbox.prompts.length = 0
    sandbox.answers.push('y')
    outcome = await account('export')
    expect(outcome.status).toBe(0)
    expect(outcome.out === owner.privateKey).toBe(true)
    expect(shows(outcome.err, owner.privateKey)).toBe(false)
    expect(sandbox.prompts).toHaveLength(1)
    expect(sandbox.prompts[0]).toContain(owner.address)
    expect(sandbox.prompts[0]).toContain('default')

    sandbox.answers.push('YES')
    expect((await account('export')).status).toBe(0)
  })

  it('reports a missing account or key before showing anything', async () => {
    sandbox.flags.terminal = sandbox.flags.outputTerminal = true
    let outcome = await account('export')
    expect(outcome.status).toBe(2)
    expect(outcome.err.startsWith('ACCOUNT_NOT_FOUND: ')).toBe(true)

    await sandbox.keystore.saveAccount(newAccount(), { dir: sandbox.dir, storage: 'none' })
    sandbox.answers.push('y')
    outcome = await account('export')
    expect(outcome.status).toBe(2)
    expect(outcome.err.startsWith('KEY_NOT_STORED: ')).toBe(true)
    expect(outcome.out).toBe('')
  })

  it('unlocks an encrypted account at the prompt', async () => {
    const owner = newAccount()
    await sandbox.keystore.saveAccount(owner, { dir: sandbox.dir, storage: 'encrypted', password: PASSWORD })
    sandbox.flags.terminal = sandbox.flags.outputTerminal = true
    sandbox.answers.push('y', OTHER_PASSWORD, PASSWORD)
    const outcome = await account('export')
    expect(outcome.status).toBe(0)
    expect(outcome.out === owner.privateKey).toBe(true)
    expect(outcome.err).toContain('Wrong password.')
    expect(shows(outcome.out + outcome.err, PASSWORD)).toBe(false)
  })
})

describe('migrate', () => {
  /** Creates a state file containing a private key for migration tests. */
  function legacyState(path: string, owner: { address: string; privateKey: string }, network = 'testnet'): string {
    mkdirSync(dirname(path), { recursive: true })
    const text = JSON.stringify({ network, privateKey: owner.privateKey, address: owner.address, dexApiToken: 'ss_test' }, null, 2)
    writeFileSync(path, text, { mode: 0o600 })
    return text
  }

  it('copies a legacy key and reports the copy that remains', async () => {
    const owner = newAccount()
    const source = join(sandbox.root, 'profile.json')
    const text = `${JSON.stringify({ address: owner.address, private_key: owner.privateKey, network: 'testnet' }, null, 2)}\n`
    writeFileSync(source, text)

    const outcome = await account('migrate', '--from', source, '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json).toEqual({ name: 'default', address: owner.address, storage: 'plaintext', path: accountFile() })
    // Preserve an external source file unless key removal is requested.
    expect(readFileSync(source, 'utf8') === text).toBe(true)
    expect(outcome.err).toContain(source)
    expect(outcome.err).toContain('--remove-legacy-key')
    expect(shows(outcome.out + outcome.err, owner.privateKey)).toBe(false)
    expect((await storedKey()) === owner.privateKey).toBe(true)
  })

  it('can strip the legacy key', async () => {
    const owner = newAccount()
    const source = join(sandbox.root, 'state.json')
    writeFileSync(
      source,
      `${JSON.stringify({ privateKey: owner.privateKey, address: owner.address, apiUrl: 'https://example.test' }, null, 2)}\n`,
    )
    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    const outcome = await account('migrate', '--from', source, '--storage', 'encrypted', '--remove-legacy-key', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json.storage).toBe('encrypted')
    expect(JSON.parse(readFileSync(source, 'utf8'))).toEqual({ address: owner.address, apiUrl: 'https://example.test' })
    expect(outcome.err.includes('--remove-legacy-key')).toBe(false)
    if (posix) expect(mode(source)).toBe(0o600)
    expect((await storedKey('default', PASSWORD)) === owner.privateKey).toBe(true)

    const again = await account('migrate', '--from', source, '--json')
    expect([again.status, again.json.error.code]).toEqual([1, 'LEGACY_KEY_NOT_FOUND'])
  })

  it('reads the state file of the selected network when --from is omitted, and records the account name', async () => {
    const testnet = newAccount()
    const mainnet = newAccount()
    const testnetState = join(sandbox.stateRoot, 'testnet', 'state.json')
    const mainnetState = join(sandbox.stateRoot, 'mainnet', 'state.json')
    legacyState(testnetState, testnet)
    legacyState(mainnetState, mainnet, 'mainnet')

    // Use testnet when no network is selected.
    let outcome = await account('migrate', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json.address).toBe(testnet.address)
    expect(outcome.err).toContain(testnetState)
    // Record the account name while preserving the source key by default.
    let state = JSON.parse(readFileSync(testnetState, 'utf8'))
    expect(state.privateKey === testnet.privateKey).toBe(true)
    expect(state).toMatchObject({ network: 'testnet', address: testnet.address, account: 'default', dexApiToken: 'ss_test' })
    if (posix) expect(mode(testnetState)).toBe(0o600)
    expect(JSON.parse(readFileSync(mainnetState, 'utf8')).account).toBeUndefined()

    outcome = await account('migrate', '--network', 'mainnet', '--name', 'main', '--remove-legacy-key', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json).toMatchObject({ name: 'main', address: mainnet.address })
    state = JSON.parse(readFileSync(mainnetState, 'utf8'))
    expect(state).toEqual({ network: 'mainnet', address: mainnet.address, dexApiToken: 'ss_test', account: 'main' })
    expect((await storedKey('main')) === mainnet.privateKey).toBe(true)

    // Honor SHIELD_SWAP_NETWORK and reject a source whose key was already removed.
    process.env.SHIELD_SWAP_NETWORK = 'mainnet'
    outcome = await account('migrate', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([1, 'LEGACY_KEY_NOT_FOUND'])
  })

  it('reads the pre-network state file for testnet, and records the name when a state file is named by --from', async () => {
    const owner = newAccount()
    const preNetwork = join(sandbox.stateRoot, 'state.json')
    legacyState(preNetwork, owner)
    const outcome = await account('migrate', '--name', 'old', '--json')
    expect(outcome.status).toBe(0)
    expect(outcome.json.address).toBe(owner.address)
    expect(JSON.parse(readFileSync(preNetwork, 'utf8')).account).toBe('old')

    const other = newAccount()
    const mainnetState = join(sandbox.stateRoot, 'mainnet', 'state.json')
    legacyState(mainnetState, other, 'mainnet')
    expect((await account('migrate', '--from', mainnetState, '--name', 'named')).status).toBe(0)
    expect(JSON.parse(readFileSync(mainnetState, 'utf8')).account).toBe('named')
  })

  it('records the address when a stripped state held a key without one', async () => {
    const owner = newAccount()
    const state = join(sandbox.stateRoot, 'testnet', 'state.json')
    mkdirSync(dirname(state), { recursive: true })
    writeFileSync(state, JSON.stringify({ network: 'testnet', privateKey: owner.privateKey }, null, 2), { mode: 0o600 })

    const outcome = await account('migrate', '--remove-legacy-key', '--json')
    expect(outcome.status).toBe(0)
    // Save the address so the session remains configured after key removal.
    expect(JSON.parse(readFileSync(state, 'utf8'))).toEqual({ network: 'testnet', account: 'default', address: owner.address })
    expect((await storedKey()) === owner.privateKey).toBe(true)
  })

  it('fails when the selected network has no state', async () => {
    const outcome = await account('migrate', '--json')
    expect([outcome.status, outcome.json.error.code]).toEqual([1, 'LEGACY_KEY_NOT_FOUND'])
    expect(outcome.json.error.message).toContain(join(sandbox.stateRoot, 'testnet', 'state.json'))
    expect(existsSync(sandbox.dir)).toBe(false)
  })
})
