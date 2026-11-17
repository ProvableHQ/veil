import { EventEmitter } from 'node:events'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateAccount, loadNetwork, privateKeyToAccount, type AleoSdk } from '../src/index.js'
import * as nodeEntry from '../src/node.js'
import {
  KeystoreError,
  accountInfo,
  exportAccount,
  loadAccount,
  migrateAccount,
  protectAccount,
  saveAccount,
} from '../src/node.js'
import { deriveSecret, normalizePassword } from '../src/keystore/encrypted.js'
import { writeFileExclusive } from '../src/keystore/file.js'
import { KEY_SERVICE, PASSWORD_SERVICE, deleteKeychain, readKeychain } from '../src/keystore/keychain.js'
import { passwordEntryAccount, passwordToKeychainValue } from '../src/keystore/password.js'
import { readHidden, runtime, type KeystoreRuntime, type SecurityRunner } from '../src/keystore/runtime.js'

/**
 * Covers the account keystore: the account file bytes, the lookup order, the
 * password sources, the Keychain commands and the storage changes.
 *
 * Every test runs in a fresh temporary directory, with the key, account and
 * password variables cleared and the home directory, the Keychain tool and
 * the terminal replaced, so nothing reads or writes the developer's own
 * accounts or Keychain. One opt-in test at the end uses the real macOS
 * Keychain with the public sample account only.
 */

vi.setConfig({ testTimeout: 60_000 })

const here = dirname(fileURLToPath(import.meta.url))
const VECTORS_DIR = join(here, 'fixtures', 'keystore-vectors')
const vectors = JSON.parse(readFileSync(join(VECTORS_DIR, 'vectors.json'), 'utf8')) as {
  account: { privateKey: string; address: string }
  encrypted: { password: string; wrongPassword: string; files: string[] }
  scrypt: Array<{ password: string; normalized?: string; salt: string; N: number; r: number; p: number; secret: string }>
  keychain: { keyService: string; passwordService: string; passwordValue: string }
  mnemonic: {
    phrase: string
    accounts: Array<{ derivation: 'standard' | 'legacy'; index: number; privateKey: string; address: string }>
  }
}
const SAMPLE = vectors.account

/** Variables a developer's shell could leak into a test. */
const VARIABLES = [
  'ALEO_PRIVATE_KEY',
  'ALEO_PRIVATE_KEY_FILE',
  'ALEO_ACCOUNT',
  'ALEO_ACCOUNTS_DIR',
  'ALEO_ACCOUNT_PASSWORD',
  'SHIELD_SWAP_PRIVATE_KEY',
  'SHIELD_SWAP_PRIVATE_KEY_FILE',
] as const

/** Test-only passwords. Never used for a funded account. */
const PASSWORD = 'correct horse battery staple'
const OTHER_PASSWORD = 'another test password'

/** An in-memory stand-in for the macOS `security` tool. */
function fakeSecurity() {
  const entries = new Map<string, string>()
  const labels = new Map<string, string>()
  const calls: Array<{ args: string[]; stdin?: string }> = []
  let override: ((args: readonly string[]) => { status: number | null; stdout: string } | undefined) | undefined
  const run: SecurityRunner = async (args, stdin) => {
    calls.push({ args: [...args], stdin })
    const forced = override?.(args)
    if (forced) return forced
    if (args.length === 1 && args[0] === '-i') {
      const match = /^add-generic-password -U -s (\S+) -a (\S+) -l (\S+) -w (\S+)\n$/.exec(stdin ?? '')
      if (!match) return { status: 1, stdout: '' }
      entries.set(`${match[1]} ${match[2]}`, match[4]!)
      labels.set(`${match[1]} ${match[2]}`, match[3]!)
      return { status: 0, stdout: '' }
    }
    if (args.length === 6 && args[0] === 'find-generic-password' && args[1] === '-s' && args[3] === '-a' && args[5] === '-w') {
      const value = entries.get(`${args[2]} ${args[4]}`)
      return value === undefined ? { status: 44, stdout: '' } : { status: 0, stdout: `${value}\n` }
    }
    if (args.length === 5 && args[0] === 'delete-generic-password' && args[1] === '-s' && args[3] === '-a') {
      return entries.delete(`${args[2]} ${args[4]}`) ? { status: 0, stdout: 'keychain: "login.keychain-db"\n' } : { status: 44, stdout: '' }
    }
    return { status: 1, stdout: '' }
  }
  return {
    entries,
    /** The label each entry was last written with. */
    labels,
    calls,
    run,
    /** Forces the outcome of matching invocations. */
    force(fn: typeof override) {
      override = fn
    },
  }
}

/** Compares two secrets without putting either into an assertion message. */
function same(a: string, b: string): boolean {
  return a === b
}

/** Resolves to the keystore error a call fails with. */
async function failure(call: Promise<unknown>): Promise<KeystoreError> {
  try {
    await call
  } catch (error) {
    if (error instanceof KeystoreError) return error
    throw error
  }
  throw new Error('expected the call to fail')
}

/** Resolves to the error code a call fails with. */
async function codeOf(call: Promise<unknown>): Promise<string> {
  return (await failure(call)).code
}

function mode(path: string): number {
  return statSync(path).mode & 0o777
}

const posix = process.platform !== 'win32'

let root: string
let home: string
let dir: string
let security: ReturnType<typeof fakeSecurity>
let notes: string[]
let prompts: string[]
let answers: string[]
let savedRuntime: KeystoreRuntime
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = {}
  for (const name of VARIABLES) {
    savedEnv[name] = process.env[name]
    delete process.env[name]
  }
  root = mkdtempSync(join(tmpdir(), 'aleo-keystore-'))
  home = join(root, 'home')
  dir = join(root, 'accounts')
  mkdirSync(home)
  security = fakeSecurity()
  notes = []
  prompts = []
  answers = []
  savedRuntime = { ...runtime }
  runtime.platform = 'darwin'
  runtime.homedir = () => home
  runtime.security = security.run
  runtime.terminalAttached = () => false
  runtime.promptHidden = async (message) => {
    prompts.push(message)
    const answer = answers.shift()
    if (answer === undefined) throw new Error('unexpected password prompt')
    return answer
  }
  runtime.notify = (message) => {
    notes.push(message)
  }
})

afterEach(() => {
  Object.assign(runtime, savedRuntime)
  for (const name of VARIABLES) {
    if (savedEnv[name] === undefined) delete process.env[name]
    else process.env[name] = savedEnv[name]
  }
  rmSync(root, { recursive: true, force: true })
})

/** Writes a crafted account file into the test accounts directory. */
function put(name: string, content: unknown): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${name}.json`)
  writeFileSync(path, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 })
  return path
}

/** The Keychain account of the key entry that one Keychain account file points at. */
function keyEntryAccount(path: string): string {
  return (JSON.parse(readFileSync(path, 'utf8')) as { key: { account: string } }).key.account
}

/** The stand-in Keychain's key for the key entry of one Keychain account file. */
function keyEntry(path: string): string {
  return `${KEY_SERVICE} ${keyEntryAccount(path)}`
}

/** The Keychain account of the saved password that belongs to one encrypted account file. */
function savedPasswordAccount(path: string): string {
  const file = JSON.parse(readFileSync(path, 'utf8')) as { address: string; key: { kdfParams: { salt: string } } }
  return passwordEntryAccount(file.address, file.key.kdfParams.salt)
}

/** The stand-in Keychain's key for the saved password of one encrypted account file. */
function savedPasswordEntry(path: string): string {
  return `${PASSWORD_SERVICE} ${savedPasswordAccount(path)}`
}

/** Copies the shared sample files into the test accounts directory. */
function copyVectors(): void {
  cpSync(VECTORS_DIR, dir, { recursive: true })
}

describe('shared sample files', () => {
  it('reads every sample account file', async () => {
    copyVectors()
    const expected = {
      none: 'none',
      plaintext: 'plaintext',
      keychain: 'keychain',
      'encrypted-js': 'encrypted',
      'encrypted-py': 'encrypted',
    } as const
    const files = readdirSync(VECTORS_DIR).filter((file) => file !== 'vectors.json').sort()
    expect(files).toEqual(Object.keys(expected).map((name) => `${name}.json`).sort())
    for (const [name, storage] of Object.entries(expected)) {
      expect(await accountInfo({ dir, name })).toEqual({
        name,
        path: join(dir, `${name}.json`),
        address: SAMPLE.address,
        storage,
      })
    }
  })

  it.each(['none', 'plaintext'] as const)('writes the %s sample byte for byte', async (storage) => {
    const stored = await saveAccount(SAMPLE, { dir, name: storage, storage })
    expect(stored).toEqual({ name: storage, path: join(dir, `${storage}.json`), address: SAMPLE.address, storage })
    const written = readFileSync(stored.path)
    expect(written.equals(readFileSync(join(VECTORS_DIR, `${storage}.json`)))).toBe(true)
  })

  it('writes the keychain sample byte for byte, apart from the entry name it chooses', async () => {
    const stored = await saveAccount(SAMPLE, { dir, name: 'keychain', storage: 'keychain' })
    const sample = readFileSync(join(VECTORS_DIR, 'keychain.json'), 'utf8')
    // Each file names an entry of its own: the address, "-", and 16 random bytes in hex.
    const chosen = keyEntryAccount(stored.path)
    expect(chosen).toMatch(new RegExp(`^${SAMPLE.address}-[0-9a-f]{32}$`))
    expect(readFileSync(stored.path, 'utf8').replace(chosen, keyEntryAccount(join(VECTORS_DIR, 'keychain.json')))).toBe(sample)
    // Two files for one account never choose the same entry.
    const again = await saveAccount(SAMPLE, { dir, name: 'again', storage: 'keychain' })
    expect(keyEntryAccount(again.path) === chosen).toBe(false)
  })

  it('returns the sample key from the plaintext and keychain samples', async () => {
    copyVectors()
    security.entries.set(keyEntry(join(dir, 'keychain.json')), SAMPLE.privateKey)
    for (const name of ['plaintext', 'keychain']) {
      const loaded = await loadAccount({ dir, name })
      expect(loaded.source).toBe('account-file')
      expect(loaded.account.address).toBe(SAMPLE.address)
      expect(same(loaded.account.privateKey, SAMPLE.privateKey)).toBe(true)
    }
    expect(await codeOf(loadAccount({ dir, name: 'none' }))).toBe('KEY_NOT_STORED')
  })

  it.each(vectors.encrypted.files)('decrypts %s and rejects the wrong password', async (file) => {
    copyVectors()
    const name = file.replace(/\.json$/, '')
    const privateKey = await exportAccount({ dir, name, password: vectors.encrypted.password, prompt: false })
    expect(same(privateKey, SAMPLE.privateKey)).toBe(true)

    const loaded = await loadAccount({ dir, name, password: vectors.encrypted.password, prompt: false })
    expect(loaded.account.address).toBe(SAMPLE.address)
    expect(loaded.stored?.storage).toBe('encrypted')

    expect(await codeOf(exportAccount({ dir, name, password: vectors.encrypted.wrongPassword, prompt: false }))).toBe('WRONG_PASSWORD')
    expect(await codeOf(loadAccount({ dir, name, password: vectors.encrypted.wrongPassword, prompt: false }))).toBe('WRONG_PASSWORD')
  })

  it('reproduces both scrypt vectors, including the NFKC one', async () => {
    expect(vectors.scrypt).toHaveLength(2)
    for (const vector of vectors.scrypt) {
      expect([vector.N, vector.r, vector.p]).toEqual([131072, 8, 1])
      const secret = await deriveSecret(normalizePassword(vector.password), Buffer.from(vector.salt, 'base64'), vector.N)
      expect(secret).toBe(vector.secret)
    }
    const nfkc = vectors.scrypt[1]!
    expect(nfkc.password === nfkc.normalized).toBe(false)
    expect(nfkc.password.normalize('NFKC') === nfkc.normalized).toBe(true)
    expect(normalizePassword(nfkc.password).equals(Buffer.from(nfkc.normalized!, 'utf8'))).toBe(true)
  })

  it('uses the sample Keychain service names and password encoding', () => {
    expect(KEY_SERVICE).toBe(vectors.keychain.keyService)
    expect(PASSWORD_SERVICE).toBe(vectors.keychain.passwordService)
    expect(passwordToKeychainValue(normalizePassword(vectors.encrypted.password))).toBe(vectors.keychain.passwordValue)
  })

  describe('recovery phrase accounts', () => {
    let aleo: AleoSdk
    beforeAll(async () => {
      aleo = await loadNetwork('testnet')
    }, 60_000)

    it('derives every sample account with mnemonicToAccount', () => {
      expect(vectors.mnemonic.accounts).toHaveLength(4)
      for (const expected of vectors.mnemonic.accounts) {
        const account = aleo.mnemonicToAccount(vectors.mnemonic.phrase, {
          index: expected.index,
          derivation: expected.derivation,
        })
        expect(account.address).toBe(expected.address)
        expect(same(account.privateKey, expected.privateKey)).toBe(true)
      }
    })
  })
})

describe('public surface', () => {
  it('exports privateKeyToAccount at the top level', () => {
    const account = privateKeyToAccount(SAMPLE.privateKey)
    expect(account.address).toBe(SAMPLE.address)
    expect(account.type).toBe('local')
    expect(account.source).toBe('privateKey')
    expect(account.viewKey.startsWith('AViewKey1')).toBe(true)
  })

  it('exports exactly the keystore functions from the node entry', () => {
    expect(Object.keys(nodeEntry).sort()).toEqual(
      [
        'KeystoreError',
        'accountInfo',
        'exportAccount',
        'fileCredentialStore',
        'loadAccount',
        'migrateAccount',
        'protectAccount',
        'saveAccount',
      ].sort(),
    )
  })

  it('keeps Node-only code out of the browser entry', () => {
    // Follow every relative import reachable from the browser entry.
    const src = resolve(here, '..', 'src')
    const seen = new Set<string>()
    const queue = [join(src, 'index.ts')]
    while (queue.length > 0) {
      const file = queue.pop()!
      if (seen.has(file)) continue
      seen.add(file)
      const source = readFileSync(file, 'utf8')
      expect(/from\s+['"]node:|import\s+['"]node:|import\(\s*['"]node:/.test(source), `${file} imports a node: module`).toBe(false)
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
        queue.push(resolve(dirname(file), match[1]!.replace(/\.js$/, '.ts')))
      }
    }
    expect(seen.has(join(src, 'account.ts'))).toBe(true)
    expect([...seen].filter((file) => file.includes(`${join(src, 'keystore')}`) || file === join(src, 'node.ts'))).toEqual([])
  })

  it('reports failures as KeystoreError with a stable code', async () => {
    const error = await failure(loadAccount({ dir }))
    expect(error).toBeInstanceOf(KeystoreError)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('KeystoreError')
    expect(error.code).toBe('ACCOUNT_NOT_FOUND')
    expect(error.message).toContain(join(dir, 'default.json'))
  })
})

describe('names and directory', () => {
  it('defaults to the account "default" under ~/.aleo/accounts', async () => {
    const stored = await saveAccount(generateAccount())
    expect(stored.name).toBe('default')
    expect(stored.path).toBe(join(home, '.aleo', 'accounts', 'default.json'))
    expect(existsSync(stored.path)).toBe(true)
  })

  it('takes the name from the option, then ALEO_ACCOUNT', async () => {
    process.env.ALEO_ACCOUNT = 'from-env'
    expect((await saveAccount(generateAccount(), { dir })).name).toBe('from-env')
    expect((await saveAccount(generateAccount(), { dir, name: 'from-option' })).name).toBe('from-option')
    process.env.ALEO_ACCOUNT = ''
    expect((await saveAccount(generateAccount(), { dir })).name).toBe('default')
  })

  it('takes the directory from the option, then ALEO_ACCOUNTS_DIR', async () => {
    const fromEnv = join(root, 'env-dir')
    process.env.ALEO_ACCOUNTS_DIR = fromEnv
    expect((await saveAccount(generateAccount())).path).toBe(join(fromEnv, 'default.json'))
    expect((await saveAccount(generateAccount(), { dir })).path).toBe(join(dir, 'default.json'))
  })

  it('expands a leading ~ in the option and in the variable', async () => {
    expect((await saveAccount(generateAccount(), { dir: '~/keys' })).path).toBe(join(home, 'keys', 'default.json'))
    process.env.ALEO_ACCOUNTS_DIR = '~/from-env'
    expect((await saveAccount(generateAccount())).path).toBe(join(home, 'from-env', 'default.json'))
    process.env.ALEO_ACCOUNTS_DIR = '~'
    expect((await saveAccount(generateAccount(), { name: 'top' })).path).toBe(join(home, 'top.json'))
  })

  it.each(['', 'Default', 'a/b', '../x', '.hidden', '-lead', '_lead', 'a.b', 'a b', 'abc\n', 'x'.repeat(65)])(
    'rejects the name %j',
    async (name) => {
      expect(await codeOf(saveAccount(generateAccount(), { dir, name }))).toBe('INVALID_NAME')
      expect(await codeOf(accountInfo({ dir, name }))).toBe('INVALID_NAME')
    },
  )

  it('rejects an invalid name from ALEO_ACCOUNT', async () => {
    process.env.ALEO_ACCOUNT = 'Not_Valid'
    expect(await codeOf(loadAccount({ dir }))).toBe('INVALID_NAME')
  })

  it.each(['a', '0', 'main-net_2', 'x'.repeat(64)])('accepts the name %j', async (name) => {
    expect((await saveAccount(generateAccount(), { dir, name })).name).toBe(name)
  })

  it.skipIf(!posix)('creates the directory at 0700 and the file at 0600', async () => {
    const stored = await saveAccount(generateAccount(), { dir: join(root, 'deep', 'accounts') })
    expect(mode(dirname(stored.path))).toBe(0o700)
    expect(mode(stored.path)).toBe(0o600)
    // Only the account file is left behind: no temporary file.
    expect(readdirSync(dirname(stored.path))).toEqual(['default.json'])
  })

  it.skipIf(!posix)('leaves the mode of an existing directory alone', async () => {
    mkdirSync(dir, { mode: 0o755 })
    chmodSync(dir, 0o755)
    await saveAccount(generateAccount(), { dir })
    expect(mode(dir)).toBe(0o755)
  })

  it.skipIf(!posix)('tightens a file that is wider than 0600 when it is read', async () => {
    const stored = await saveAccount(generateAccount(), { dir })
    chmodSync(stored.path, 0o644)
    await accountInfo({ dir })
    expect(mode(stored.path)).toBe(0o600)
    chmodSync(stored.path, 0o640)
    await loadAccount({ dir })
    expect(mode(stored.path)).toBe(0o600)
    chmodSync(stored.path, 0o400)
    await loadAccount({ dir })
    expect(mode(stored.path)).toBe(0o400)
  })
})

describe('account file format', () => {
  const address = SAMPLE.address
  const encrypted = () =>
    JSON.parse(readFileSync(join(VECTORS_DIR, 'encrypted-js.json'), 'utf8')) as {
      version: number
      address: string
      key: { type: string; kdf: string; kdfParams: { N: number; r: number; p: number; salt: string }; ciphertext: string }
    }

  it('returns nothing for a missing file', async () => {
    expect(await accountInfo({ dir })).toBeUndefined()
  })

  it.each([
    ['text that is not JSON', 'not json'],
    ['a byte-order mark', `﻿${JSON.stringify({ version: 1, address, key: { type: 'none' } })}`],
    ['an array', '[]'],
    ['null', 'null'],
    ['a missing version', { address, key: { type: 'none' } }],
    ['a string version', { version: '1', address, key: { type: 'none' } }],
    ['a fractional version', { version: 1.5, address, key: { type: 'none' } }],
    ['a boolean version', { version: true, address, key: { type: 'none' } }],
    ['a missing address', { version: 1, key: { type: 'none' } }],
    ['a numeric address', { version: 1, address: 5, key: { type: 'none' } }],
    ['a missing key', { version: 1, address }],
    ['a key that is not an object', { version: 1, address, key: 'none' }],
    ['a missing key type', { version: 1, address, key: {} }],
    ['a numeric key type', { version: 1, address, key: { type: 1 } }],
    ['an extra top-level field', { version: 1, address, key: { type: 'none' }, network: 'testnet' }],
    ['an extra field in a none key', { version: 1, address, key: { type: 'none', privateKey: 'x' } }],
    ['a plaintext key without privateKey', { version: 1, address, key: { type: 'plaintext' } }],
    ['a plaintext key with a numeric privateKey', { version: 1, address, key: { type: 'plaintext', privateKey: 1 } }],
    ['a plaintext key with an extra field', { version: 1, address, key: { type: 'plaintext', privateKey: 'x', note: '' } }],
    ['a keychain key without account', { version: 1, address, key: { type: 'keychain', service: KEY_SERVICE } }],
    ['a keychain key with another service', { version: 1, address, key: { type: 'keychain', service: 'login', account: address } }],
    ['a keychain key with another account', { version: 1, address, key: { type: 'keychain', service: KEY_SERVICE, account: 'aleo1other' } }],
    ['a keychain key named after the bare address', { version: 1, address, key: { type: 'keychain', service: KEY_SERVICE, account: address } }],
    ["a keychain key named after another address's entry", { version: 1, address, key: { type: 'keychain', service: KEY_SERVICE, account: `aleo1other-${'0'.repeat(32)}` } }],
    ['a keychain key with a malformed entry name', { version: 1, address, key: { type: 'keychain', service: KEY_SERVICE, account: `${address}-XYZ` } }],
  ])('rejects %s', async (_label, content) => {
    put('default', content)
    expect(await codeOf(accountInfo({ dir }))).toBe('INVALID_ACCOUNT_FILE')
    expect(await codeOf(loadAccount({ dir }))).toBe('INVALID_ACCOUNT_FILE')
  })

  it('rejects a file that is not UTF-8', async () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'default.json'), Buffer.from([0x7b, 0xff, 0xfe, 0x7d]))
    expect(await codeOf(accountInfo({ dir }))).toBe('INVALID_ACCOUNT_FILE')
  })

  it.each([
    ['another kdf', (file: ReturnType<typeof encrypted>) => void (file.key.kdf = 'argon2id')],
    ['N below 2^14', (file: ReturnType<typeof encrypted>) => void (file.key.kdfParams.N = 2 ** 13)],
    ['N above 2^20', (file: ReturnType<typeof encrypted>) => void (file.key.kdfParams.N = 2 ** 21)],
    ['N that is not a power of two', (file: ReturnType<typeof encrypted>) => void (file.key.kdfParams.N = 100000)],
    ['a fractional N', (file: ReturnType<typeof encrypted>) => void (file.key.kdfParams.N = 16384.5)],
    ['a string N', (file: ReturnType<typeof encrypted>) => void ((file.key.kdfParams as { N: unknown }).N = '131072')],
    ['r other than 8', (file: ReturnType<typeof encrypted>) => void (file.key.kdfParams.r = 16)],
    ['p other than 1', (file: ReturnType<typeof encrypted>) => void (file.key.kdfParams.p = 2)],
    ['a boolean p', (file: ReturnType<typeof encrypted>) => void ((file.key.kdfParams as { p: unknown }).p = true)],
    ['a salt shorter than 16 bytes', (file: ReturnType<typeof encrypted>) => void (file.key.kdfParams.salt = Buffer.alloc(15).toString('base64'))],
    ['a salt that is not base64', (file: ReturnType<typeof encrypted>) => void (file.key.kdfParams.salt = '!!!!!!!!!!!!!!!!!!!!!!!!')],
    ['a salt without padding', (file: ReturnType<typeof encrypted>) => void (file.key.kdfParams.salt = file.key.kdfParams.salt.replace(/=+$/, ''))],
    ['a missing ciphertext', (file: ReturnType<typeof encrypted>) => void delete (file.key as { ciphertext?: string }).ciphertext],
    ['an extra kdf parameter', (file: ReturnType<typeof encrypted>) => void ((file.key.kdfParams as Record<string, unknown>).dkLen = 32)],
    ['an extra key field', (file: ReturnType<typeof encrypted>) => void ((file.key as Record<string, unknown>).hint = 'x')],
  ])('rejects an encrypted file with %s', async (_label, change) => {
    const file = encrypted()
    change(file)
    put('default', file)
    expect(await codeOf(accountInfo({ dir }))).toBe('INVALID_ACCOUNT_FILE')
  })

  it.each([2 ** 14, 2 ** 15, 2 ** 20])('accepts an encrypted file with N = %d', async (N) => {
    const file = encrypted()
    file.key.kdfParams.N = N
    put('default', file)
    expect((await accountInfo({ dir }))?.storage).toBe('encrypted')
  })

  it('accepts whole numbers written with a fraction or an exponent', async () => {
    // JSON has one number type, so 1.0 and 1e0 are the integer 1.
    const file = encrypted()
    const text = JSON.stringify(file, null, 2)
      .replace('"version": 1,', '"version": 1.0,')
      .replace('"N": 131072,', '"N": 1.31072e5,')
      .replace('"r": 8,', '"r": 8.0,')
      .replace('"p": 1,', '"p": 1e0,')
    expect(text).toContain('"version": 1.0,')
    expect(text).toContain('"N": 1.31072e5,')
    expect(text).toContain('"r": 8.0,')
    expect(text).toContain('"p": 1e0,')
    put('default', `${text}\n`)
    expect((await accountInfo({ dir }))?.storage).toBe('encrypted')
    expect(same(await exportAccount({ dir, password: vectors.encrypted.password, prompt: false }), SAMPLE.privateKey)).toBe(true)

    put('default', `${JSON.stringify({ version: 1, address, key: { type: 'none' } }).replace('"version":1', '"version":2.0')}\n`)
    expect(await codeOf(accountInfo({ dir }))).toBe('UNSUPPORTED_VERSION')
  })

  it('decrypts a file whose cost is above the default', async () => {
    // Written by hand at N = 2^18, which needs more memory than the default cost.
    const { PrivateKey, PrivateKeyCiphertext } = await import('@provablehq/sdk')
    const account = generateAccount()
    const salt = Buffer.alloc(16, 7)
    const secret = await deriveSecret(normalizePassword(PASSWORD), salt, 2 ** 18)
    const ciphertext = PrivateKeyCiphertext.encryptPrivateKey(PrivateKey.from_string(account.privateKey), secret).toString()
    put('default', {
      version: 1,
      address: account.address,
      key: { type: 'encrypted', kdf: 'scrypt', kdfParams: { N: 2 ** 18, r: 8, p: 1, salt: salt.toString('base64') }, ciphertext },
    })
    expect(same(await exportAccount({ dir, password: PASSWORD }), account.privateKey)).toBe(true)
  })

  it.each([0, 2, -1])('reports version %d as unsupported, even with unknown fields', async (version) => {
    put('default', { version, address, key: { type: 'none' }, added: true })
    expect(await codeOf(accountInfo({ dir }))).toBe('UNSUPPORTED_VERSION')
    process.env.ALEO_PRIVATE_KEY = SAMPLE.privateKey
    expect(await codeOf(loadAccount({ dir }))).toBe('UNSUPPORTED_VERSION')
  })

  it('reports an unknown storage type as unsupported and does not fall back', async () => {
    put('default', { version: 1, address, key: { type: 'secret-service', collection: 'login' } })
    expect(await codeOf(accountInfo({ dir }))).toBe('UNSUPPORTED_STORAGE')
    process.env.ALEO_PRIVATE_KEY = SAMPLE.privateKey
    expect(await codeOf(loadAccount({ dir }))).toBe('UNSUPPORTED_STORAGE')
    expect(await codeOf(loadAccount({ dir, legacyKey: SAMPLE.privateKey }))).toBe('UNSUPPORTED_STORAGE')
  })

  it('does not quote a malformed file in the error', async () => {
    const account = generateAccount()
    put('default', `{"version": 1, "address": "${account.address}", "key": {"type": "plaintext", "privateKey": "${account.privateKey}" oops`)
    const error = await failure(loadAccount({ dir }))
    expect(error.code).toBe('INVALID_ACCOUNT_FILE')
    expect(error.message.includes(account.privateKey)).toBe(false)
    expect(error.cause).toBeUndefined()
  })

  it('reports an unparseable or mismatched plaintext key', async () => {
    put('default', { version: 1, address, key: { type: 'plaintext', privateKey: 'APrivateKey1nope' } })
    expect((await accountInfo({ dir }))?.storage).toBe('plaintext')
    expect(await codeOf(loadAccount({ dir }))).toBe('INVALID_KEY')

    const other = generateAccount()
    put('default', { version: 1, address, key: { type: 'plaintext', privateKey: other.privateKey } })
    const error = await failure(loadAccount({ dir }))
    expect(error.code).toBe('ADDRESS_MISMATCH')
    expect(error.message).toContain(address)
    expect(error.message).toContain(other.address)
    expect(error.message.includes(other.privateKey)).toBe(false)
  })
})

describe('saveAccount', () => {
  it('stores plaintext by default and returns the account without its key', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir })
    expect(stored).toEqual({ name: 'default', path: join(dir, 'default.json'), address: account.address, storage: 'plaintext' })
    const file = JSON.parse(readFileSync(stored.path, 'utf8'))
    expect(Object.keys(file)).toEqual(['version', 'address', 'key'])
    expect(Object.keys(file.key)).toEqual(['type', 'privateKey'])
    expect(same(file.key.privateKey, account.privateKey)).toBe(true)
  })

  it('accepts a bare address and private key pair', async () => {
    const { address, privateKey } = generateAccount()
    expect((await saveAccount({ address, privateKey }, { dir })).address).toBe(address)
  })

  it('returns without rewriting for the same account and storage', async () => {
    const account = generateAccount()
    const first = await saveAccount(account, { dir })
    const before = statSync(first.path)
    const again = await saveAccount(account, { dir })
    expect(again).toEqual(first)
    const after = statSync(first.path)
    expect(after.ino).toBe(before.ino)
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })

  it('refuses the same account with another storage and points at protectAccount', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir })
    const error = await failure(saveAccount(account, { dir, storage: 'none' }))
    expect(error.code).toBe('ACCOUNT_EXISTS')
    expect(error.message).toContain('protectAccount')
    expect((await accountInfo({ dir }))?.storage).toBe('plaintext')
  })

  it('refuses to replace a file that holds another address', async () => {
    const first = generateAccount()
    const second = generateAccount()
    const stored = await saveAccount(first, { dir })
    const bytes = readFileSync(stored.path)
    const error = await failure(saveAccount(second, { dir }))
    expect(error.code).toBe('ACCOUNT_EXISTS')
    expect(error.message).toContain(first.address)
    expect(error.message).toContain(second.address)
    expect(readFileSync(stored.path).equals(bytes)).toBe(true)
  })

  it('does not overwrite a file it cannot read', async () => {
    const path = put('default', { version: 2, address: 'aleo1future', key: {} })
    const bytes = readFileSync(path)
    expect(await codeOf(saveAccount(generateAccount(), { dir }))).toBe('UNSUPPORTED_VERSION')
    expect(readFileSync(path).equals(bytes)).toBe(true)
  })

  it('rejects a key that cannot be parsed or does not derive the address', async () => {
    const account = generateAccount()
    const bad = await failure(saveAccount({ address: account.address, privateKey: 'APrivateKey1nope' }, { dir }))
    expect(bad.code).toBe('INVALID_KEY')
    expect(bad.message.includes('APrivateKey1nope')).toBe(false)
    expect(await codeOf(saveAccount({ address: SAMPLE.address, privateKey: account.privateKey }, { dir }))).toBe('ADDRESS_MISMATCH')
    expect(existsSync(join(dir, 'default.json'))).toBe(false)
  })

  it('rejects an unknown storage type', async () => {
    const storage = 'vault' as unknown as 'plaintext'
    expect(await codeOf(saveAccount(generateAccount(), { dir, storage }))).toBe('UNSUPPORTED_STORAGE')
  })

  it('writes the address-only form for storage none', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'none' })
    expect(stored.storage).toBe('none')
    expect(readFileSync(stored.path, 'utf8').includes(account.privateKey)).toBe(false)
    expect(JSON.parse(readFileSync(stored.path, 'utf8'))).toEqual({ version: 1, address: account.address, key: { type: 'none' } })
  })
})

describe('loadAccount lookup order', () => {
  it('fails with ACCOUNT_NOT_FOUND when nothing supplies a key, and generates nothing', async () => {
    expect(await codeOf(loadAccount({ dir }))).toBe('ACCOUNT_NOT_FOUND')
    expect(existsSync(dir)).toBe(false)
  })

  it('reads the account file when the environment supplies nothing', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir })
    const loaded = await loadAccount({ dir })
    expect(loaded.source).toBe('account-file')
    expect(loaded.stored).toEqual(stored)
    expect(loaded.account.address).toBe(account.address)
    expect(same(loaded.account.privateKey, account.privateKey)).toBe(true)
    expect(loaded.account.type).toBe('local')
    expect(typeof loaded.account.signMessage).toBe('function')
  })

  it('prefers an explicit key and then ignores the key variables', async () => {
    const account = generateAccount()
    process.env.ALEO_PRIVATE_KEY = ''
    process.env.SHIELD_SWAP_PRIVATE_KEY = generateAccount().privateKey
    const loaded = await loadAccount({ dir, privateKey: account.privateKey })
    expect(loaded.source).toBe('argument')
    expect(loaded.stored).toBeUndefined()
    expect(loaded.account.address).toBe(account.address)
  })

  it.each(['ALEO_PRIVATE_KEY', 'SHIELD_SWAP_PRIVATE_KEY'])('reads the key from %s', async (variable) => {
    const account = generateAccount()
    process.env[variable] = `  ${account.privateKey}\n`
    const loaded = await loadAccount({ dir })
    expect(loaded.source).toBe('env')
    expect(loaded.account.address).toBe(account.address)
    // A key from the environment is used for the process and never stored.
    expect(existsSync(dir)).toBe(false)
  })

  it.each(['ALEO_PRIVATE_KEY_FILE', 'SHIELD_SWAP_PRIVATE_KEY_FILE'])('reads the key from the file named by %s', async (variable) => {
    const account = generateAccount()
    const keyFile = join(root, 'key.txt')
    writeFileSync(keyFile, `\n ${account.privateKey} \n`, { mode: 0o600 })
    process.env[variable] = keyFile
    const loaded = await loadAccount({ dir })
    expect(loaded.source).toBe('env-file')
    expect(loaded.account.address).toBe(account.address)
    expect(existsSync(dir)).toBe(false)
  })

  it('reports the variable ahead of the key file when both hold the same key', async () => {
    const account = generateAccount()
    const keyFile = join(root, 'key.txt')
    writeFileSync(keyFile, account.privateKey, { mode: 0o600 })
    process.env.ALEO_PRIVATE_KEY_FILE = keyFile
    process.env.SHIELD_SWAP_PRIVATE_KEY_FILE = keyFile
    process.env.SHIELD_SWAP_PRIVATE_KEY = account.privateKey
    process.env.ALEO_PRIVATE_KEY = account.privateKey
    const loaded = await loadAccount({ dir })
    expect(loaded.source).toBe('env')
    expect(loaded.account.address).toBe(account.address)
  })

  it.each([
    ['ALEO_PRIVATE_KEY', 'SHIELD_SWAP_PRIVATE_KEY'],
    ['ALEO_PRIVATE_KEY', 'ALEO_PRIVATE_KEY_FILE'],
    ['SHIELD_SWAP_PRIVATE_KEY', 'SHIELD_SWAP_PRIVATE_KEY_FILE'],
    ['ALEO_PRIVATE_KEY_FILE', 'SHIELD_SWAP_PRIVATE_KEY_FILE'],
  ])('fails with KEY_CONFLICT when %s and %s hold different keys', async (one, two) => {
    const first = generateAccount()
    const second = generateAccount()
    const set = (variable: string, key: string) => {
      if (variable.endsWith('_FILE')) {
        const keyFile = join(root, `${variable}.txt`)
        writeFileSync(keyFile, key, { mode: 0o600 })
        process.env[variable] = keyFile
      } else process.env[variable] = key
    }
    set(one, first.privateKey)
    set(two, second.privateKey)
    const error = await failure(loadAccount({ dir }))
    expect(error.code).toBe('KEY_CONFLICT')
    expect(error.message).toContain(one)
    expect(error.message).toContain(two)
    expect(error.message.includes(first.privateKey) || error.message.includes(second.privateKey)).toBe(false)
  })

  it.each(['ALEO_PRIVATE_KEY', 'SHIELD_SWAP_PRIVATE_KEY', 'ALEO_PRIVATE_KEY_FILE', 'SHIELD_SWAP_PRIVATE_KEY_FILE'])(
    'fails with EMPTY_KEY_SOURCE when %s is set but empty, even with an account file',
    async (variable) => {
      await saveAccount(generateAccount(), { dir })
      process.env[variable] = ''
      expect(await codeOf(loadAccount({ dir }))).toBe('EMPTY_KEY_SOURCE')
      process.env[variable] = '   '
      expect(await codeOf(loadAccount({ dir }))).toBe('EMPTY_KEY_SOURCE')
    },
  )

  it('fails with EMPTY_KEY_SOURCE for an empty or missing key file', async () => {
    const keyFile = join(root, 'key.txt')
    writeFileSync(keyFile, ' \n', { mode: 0o600 })
    process.env.ALEO_PRIVATE_KEY_FILE = keyFile
    expect(await codeOf(loadAccount({ dir }))).toBe('EMPTY_KEY_SOURCE')
    process.env.ALEO_PRIVATE_KEY_FILE = join(root, 'absent.txt')
    const error = await failure(loadAccount({ dir, legacyKey: generateAccount().privateKey }))
    expect(error.code).toBe('EMPTY_KEY_SOURCE')
    expect(error.message).toContain('absent.txt')
  })

  it('fails with INVALID_KEY without echoing the value', async () => {
    process.env.ALEO_PRIVATE_KEY = 'APrivateKey1definitelynotakey'
    const error = await failure(loadAccount({ dir }))
    expect(error.code).toBe('INVALID_KEY')
    expect(error.message).toContain('ALEO_PRIVATE_KEY')
    expect(error.message.includes('definitelynotakey')).toBe(false)
    expect(error.cause).toBeUndefined()
    delete process.env.ALEO_PRIVATE_KEY
    expect(await codeOf(loadAccount({ dir, privateKey: '' }))).toBe('INVALID_KEY')
  })

  it('requires a key from the caller or the environment to match the account file', async () => {
    const account = generateAccount()
    const other = generateAccount()
    const stored = await saveAccount(account, { dir })

    process.env.ALEO_PRIVATE_KEY = account.privateKey
    const matching = await loadAccount({ dir })
    expect(matching.source).toBe('env')
    expect(matching.stored).toEqual(stored)

    process.env.ALEO_PRIVATE_KEY = other.privateKey
    const error = await failure(loadAccount({ dir }))
    expect(error.code).toBe('ADDRESS_MISMATCH')
    expect(error.message).toContain(account.address)
    expect(error.message).toContain(other.address)

    delete process.env.ALEO_PRIVATE_KEY
    expect(await codeOf(loadAccount({ dir, privateKey: other.privateKey }))).toBe('ADDRESS_MISMATCH')
    expect((await loadAccount({ dir, privateKey: account.privateKey })).source).toBe('argument')
  })

  it('uses an address-only file to check a key from the environment', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir, storage: 'none' })
    expect(await codeOf(loadAccount({ dir }))).toBe('KEY_NOT_STORED')
    expect(await codeOf(loadAccount({ dir, legacyKey: account.privateKey }))).toBe('KEY_NOT_STORED')

    process.env.ALEO_PRIVATE_KEY = account.privateKey
    const loaded = await loadAccount({ dir })
    expect(loaded.source).toBe('env')
    expect(loaded.stored?.storage).toBe('none')

    process.env.ALEO_PRIVATE_KEY = generateAccount().privateKey
    expect(await codeOf(loadAccount({ dir }))).toBe('ADDRESS_MISMATCH')
  })

  it('checks the resolved key against expectedAddress', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir })
    expect((await loadAccount({ dir, expectedAddress: account.address })).account.address).toBe(account.address)
    const error = await failure(loadAccount({ dir, expectedAddress: SAMPLE.address }))
    expect(error.code).toBe('ADDRESS_MISMATCH')
    expect(error.message).toContain(account.address)
    expect(error.message).toContain(SAMPLE.address)
    expect(await codeOf(loadAccount({ dir: join(root, 'empty'), privateKey: account.privateKey, expectedAddress: SAMPLE.address }))).toBe('ADDRESS_MISMATCH')
  })

  it('uses the legacy key only when nothing else supplies one', async () => {
    const legacy = generateAccount()
    const fromLegacy = await loadAccount({ dir, legacyKey: legacy.privateKey })
    expect(fromLegacy.source).toBe('legacy')
    expect(fromLegacy.stored).toBeUndefined()
    expect(fromLegacy.account.address).toBe(legacy.address)
    expect(existsSync(dir)).toBe(false)

    const env = generateAccount()
    process.env.ALEO_PRIVATE_KEY = env.privateKey
    const fromEnv = await loadAccount({ dir, legacyKey: legacy.privateKey })
    expect(fromEnv.source).toBe('env')
    expect(fromEnv.account.address).toBe(env.address)
    delete process.env.ALEO_PRIVATE_KEY

    expect(await codeOf(loadAccount({ dir, legacyKey: 'APrivateKey1nope' }))).toBe('INVALID_KEY')
  })

  it('prefers the account file over a legacy key and requires them to match', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir })
    const loaded = await loadAccount({ dir, legacyKey: account.privateKey })
    expect(loaded.source).toBe('account-file')
    const error = await failure(loadAccount({ dir, legacyKey: generateAccount().privateKey }))
    expect(error.code).toBe('ADDRESS_MISMATCH')
    expect(error.message).toContain(account.address)
  })
})

describe('encrypted storage and password sources', () => {
  it('writes the encrypted form with a fresh salt and the fixed scrypt cost', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD })
    expect(stored.storage).toBe('encrypted')
    const text = readFileSync(stored.path, 'utf8')
    expect(text.includes(account.privateKey)).toBe(false)
    expect(text.includes(PASSWORD)).toBe(false)
    const file = JSON.parse(text)
    expect(Object.keys(file)).toEqual(['version', 'address', 'key'])
    expect(Object.keys(file.key)).toEqual(['type', 'kdf', 'kdfParams', 'ciphertext'])
    expect(Object.keys(file.key.kdfParams)).toEqual(['N', 'r', 'p', 'salt'])
    expect(file.key.kdf).toBe('scrypt')
    expect([file.key.kdfParams.N, file.key.kdfParams.r, file.key.kdfParams.p]).toEqual([131072, 8, 1])
    expect(Buffer.from(file.key.kdfParams.salt, 'base64')).toHaveLength(16)
    expect(file.key.kdfParams.salt).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(file.key.ciphertext.startsWith('ciphertext1')).toBe(true)
    expect(text).toBe(`${JSON.stringify(file, null, 2)}\n`)
    // Nothing reached the Keychain without savePassword.
    expect(security.calls).toEqual([])

    const second = await saveAccount(account, { dir, name: 'second', storage: 'encrypted', password: PASSWORD })
    const other = JSON.parse(readFileSync(second.path, 'utf8'))
    expect(other.key.kdfParams.salt === file.key.kdfParams.salt).toBe(false)
  })

  it('takes the password from the option, then the variable', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD })

    const viaOption = await loadAccount({ dir, password: PASSWORD, prompt: false })
    expect(viaOption.source).toBe('account-file')
    expect(same(viaOption.account.privateKey, account.privateKey)).toBe(true)

    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    expect((await loadAccount({ dir, prompt: false })).account.address).toBe(account.address)

    // The option wins over the variable, and a wrong one does not fall through.
    process.env.ALEO_ACCOUNT_PASSWORD = OTHER_PASSWORD
    expect((await loadAccount({ dir, password: PASSWORD })).account.address).toBe(account.address)
    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    expect(await codeOf(loadAccount({ dir, password: OTHER_PASSWORD }))).toBe('WRONG_PASSWORD')
  })

  it('does not fall through to the Keychain or the prompt after a wrong variable', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD, savePassword: true })
    runtime.terminalAttached = () => true
    answers.push(PASSWORD)
    process.env.ALEO_ACCOUNT_PASSWORD = OTHER_PASSWORD
    const error = await failure(loadAccount({ dir }))
    expect(error.code).toBe('WRONG_PASSWORD')
    expect(error.message.includes(OTHER_PASSWORD)).toBe(false)
    expect(prompts).toEqual([])
  })

  it('sets the password from the variable when none is passed', async () => {
    const account = generateAccount()
    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    await saveAccount(account, { dir, storage: 'encrypted' })
    delete process.env.ALEO_ACCOUNT_PASSWORD
    expect(same(await exportAccount({ dir, password: PASSWORD }), account.privateKey)).toBe(true)
  })

  it('treats passwords that are equal under NFKC as the same password', async () => {
    const account = generateAccount()
    // U+FF50 FULLWIDTH LATIN SMALL LETTER P, U+00A0 NO-BREAK SPACE, and "e" + U+0301.
    await saveAccount(account, { dir, storage: 'encrypted', password: 'ｐass word é' })
    expect(same(await exportAccount({ dir, password: 'pass word é' }), account.privateKey)).toBe(true)
  })

  it('rejects an empty password', async () => {
    const account = generateAccount()
    expect(await codeOf(saveAccount(account, { dir, storage: 'encrypted', password: '' }))).toBe('PASSWORD_REQUIRED')
    expect(existsSync(join(dir, 'default.json'))).toBe(false)
    await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD })
    expect(await codeOf(loadAccount({ dir, password: '' }))).toBe('PASSWORD_REQUIRED')
  })

  it('fails with PASSWORD_REQUIRED when no source supplies a password', async () => {
    const account = generateAccount()
    expect(await codeOf(saveAccount(account, { dir, storage: 'encrypted' }))).toBe('PASSWORD_REQUIRED')
    expect(existsSync(join(dir, 'default.json'))).toBe(false)

    await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD })
    expect(await codeOf(loadAccount({ dir }))).toBe('PASSWORD_REQUIRED')
    expect(await codeOf(exportAccount({ dir }))).toBe('PASSWORD_REQUIRED')
    // An empty variable counts as unset.
    process.env.ALEO_ACCOUNT_PASSWORD = ''
    expect(await codeOf(loadAccount({ dir }))).toBe('PASSWORD_REQUIRED')
    // A terminal is attached, but the caller forbade prompting.
    runtime.terminalAttached = () => true
    expect(await codeOf(loadAccount({ dir, prompt: false }))).toBe('PASSWORD_REQUIRED')
    expect(prompts).toEqual([])
  })

  it('reads a saved password from the Keychain', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD, savePassword: true })
    // The entry is named after the address and this file's salt.
    const entryAccount = savedPasswordAccount(stored.path)
    expect(entryAccount).toMatch(new RegExp(`^${account.address}-[0-9a-f]{32}$`))
    expect(security.entries.get(`${PASSWORD_SERVICE} ${entryAccount}`)).toBe(Buffer.from(PASSWORD, 'utf8').toString('hex'))
    security.calls.length = 0

    const loaded = await loadAccount({ dir, prompt: false })
    expect(loaded.account.address).toBe(account.address)
    expect(security.calls).toEqual([
      { args: ['find-generic-password', '-s', 'aleo-account-password', '-a', entryAccount, '-w'], stdin: undefined },
    ])
  })

  it('fails on a wrong saved password without prompting', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD })
    security.entries.set(savedPasswordEntry(stored.path), Buffer.from(OTHER_PASSWORD, 'utf8').toString('hex'))
    runtime.terminalAttached = () => true
    answers.push(PASSWORD)
    expect(await codeOf(loadAccount({ dir }))).toBe('WRONG_PASSWORD')
    expect(prompts).toEqual([])
    // The variable is consulted first, so it still unlocks the account.
    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    expect((await loadAccount({ dir })).account.address).toBe(account.address)
  })

  it('reports a failing Keychain lookup instead of prompting', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD })
    security.force((args) => (args[0] === 'find-generic-password' ? { status: 36, stdout: '' } : undefined))
    runtime.terminalAttached = () => true
    expect(await codeOf(loadAccount({ dir }))).toBe('KEYCHAIN_FAILED')
    security.force(undefined)
    security.entries.set(savedPasswordEntry(stored.path), 'not-hex')
    expect(await codeOf(loadAccount({ dir }))).toBe('KEYCHAIN_FAILED')
  })

  it('skips the Keychain outside macOS and ignores savePassword there', async () => {
    runtime.platform = 'linux'
    const account = generateAccount()
    await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD, savePassword: true })
    expect(await codeOf(loadAccount({ dir }))).toBe('PASSWORD_REQUIRED')
    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    expect((await loadAccount({ dir })).account.address).toBe(account.address)
    expect(security.calls).toEqual([])
  })

  it('prompts on the terminal and allows three attempts', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD })
    runtime.terminalAttached = () => true

    answers.push(OTHER_PASSWORD, '', PASSWORD)
    const loaded = await loadAccount({ dir })
    expect(loaded.account.address).toBe(account.address)
    expect(prompts).toHaveLength(3)
    expect(prompts[0]).toContain(account.address)
    expect(prompts[0]).toContain('default')
    expect(notes).toEqual(['Wrong password.', 'The password must not be empty.'])

    prompts.length = 0
    answers.push(OTHER_PASSWORD, OTHER_PASSWORD, OTHER_PASSWORD, PASSWORD)
    expect(await codeOf(loadAccount({ dir }))).toBe('WRONG_PASSWORD')
    expect(prompts).toHaveLength(3)
    expect(answers).toEqual([PASSWORD])
  })

  it('asks twice when setting a password at the terminal', async () => {
    const account = generateAccount()
    runtime.terminalAttached = () => true
    answers.push(PASSWORD, OTHER_PASSWORD, '', '', PASSWORD, PASSWORD)
    await saveAccount(account, { dir, storage: 'encrypted' })
    expect(prompts).toHaveLength(6)
    expect(notes).toEqual(['The passwords do not match.', 'The password must not be empty.'])
    expect(same(await exportAccount({ dir, password: PASSWORD, prompt: false }), account.privateKey)).toBe(true)

    answers.push(PASSWORD, OTHER_PASSWORD, PASSWORD, OTHER_PASSWORD, PASSWORD, OTHER_PASSWORD)
    expect(await codeOf(saveAccount(generateAccount(), { dir, name: 'second', storage: 'encrypted' }))).toBe('PASSWORD_REQUIRED')
    expect(existsSync(join(dir, 'second.json'))).toBe(false)
  })

  it('reports a damaged ciphertext as a wrong password', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD })
    const file = JSON.parse(readFileSync(stored.path, 'utf8'))
    file.key.ciphertext = 'ciphertext1qqqq'
    put('default', file)
    expect(await codeOf(loadAccount({ dir, password: PASSWORD }))).toBe('WRONG_PASSWORD')
  })

  it('reports a ciphertext for another account as a wrong password', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD })
    const file = JSON.parse(readFileSync(stored.path, 'utf8'))
    file.address = SAMPLE.address
    put('default', file)
    expect(await codeOf(loadAccount({ dir, password: PASSWORD }))).toBe('WRONG_PASSWORD')
  })
})

describe('Keychain storage', () => {
  it('writes the key through security -i and never as a process argument', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'keychain' })
    expect(stored.storage).toBe('keychain')
    const entry = keyEntryAccount(stored.path)
    const find = { args: ['find-generic-password', '-s', 'aleo-account-key', '-a', entry, '-w'], stdin: undefined }
    expect(security.calls).toHaveLength(3)
    // The entry is looked for before it is written.
    expect(security.calls[0]).toEqual(find)
    expect(security.calls[1]!.args).toEqual(['-i'])
    expect(same(security.calls[1]!.stdin!, `add-generic-password -U -s aleo-account-key -a ${entry} -l aleo-account-key:default -w ${account.privateKey}\n`)).toBe(true)
    // The write is confirmed by reading the entry back.
    expect(security.calls[2]).toEqual(find)
    for (const call of security.calls) expect(call.args.some((arg) => arg.includes('APrivateKey1'))).toBe(false)

    const text = readFileSync(stored.path, 'utf8')
    expect(text.includes('APrivateKey1')).toBe(false)
    expect(JSON.parse(text)).toEqual({
      version: 1,
      address: account.address,
      key: { type: 'keychain', service: 'aleo-account-key', account: entry },
    })
    expect(entry).toMatch(new RegExp(`^${account.address}-[0-9a-f]{32}$`))
  })

  it('labels each entry with the account name and finds it by the name the file records', async () => {
    const first = generateAccount()
    const tradingKey = await saveAccount(first, { dir, name: 'trading', storage: 'keychain' })
    expect(security.labels.get(keyEntry(tradingKey.path))).toBe('aleo-account-key:trading')

    const second = generateAccount()
    const bot = await saveAccount(second, { dir, name: 'bot_1-a', storage: 'encrypted', password: PASSWORD, savePassword: true })
    expect(security.labels.get(savedPasswordEntry(bot.path))).toBe('aleo-account-password:bot_1-a')

    // Changing the storage writes the new entry under the same account name.
    const botKey = await protectAccount({ dir, name: 'bot_1-a', storage: 'keychain', password: PASSWORD })
    expect(security.labels.get(keyEntry(botKey.path))).toBe('aleo-account-key:bot_1-a')
    const trading = await protectAccount({ dir, name: 'trading', storage: 'encrypted', password: PASSWORD, savePassword: true })
    expect(security.labels.get(savedPasswordEntry(trading.path))).toBe('aleo-account-password:trading')

    // The label plays no part in the lookup: reads name only the service and the entry.
    security.calls.length = 0
    await loadAccount({ dir, name: 'bot_1-a' })
    expect(security.calls).toEqual([
      { args: ['find-generic-password', '-s', 'aleo-account-key', '-a', keyEntryAccount(botKey.path), '-w'], stdin: undefined },
    ])
  })

  it('reads the key back from the Keychain', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'keychain' })
    security.calls.length = 0
    const loaded = await loadAccount({ dir })
    expect(loaded.source).toBe('account-file')
    expect(same(loaded.account.privateKey, account.privateKey)).toBe(true)
    expect(security.calls).toEqual([
      { args: ['find-generic-password', '-s', 'aleo-account-key', '-a', keyEntryAccount(stored.path), '-w'], stdin: undefined },
    ])
  })

  it('maps exit status 44 to KEYCHAIN_ITEM_NOT_FOUND and other failures to KEYCHAIN_FAILED', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir, storage: 'keychain' })
    security.entries.clear()
    const missing = await failure(loadAccount({ dir }))
    expect(missing.code).toBe('KEYCHAIN_ITEM_NOT_FOUND')
    expect(missing.message).toContain(account.address)

    security.force(() => ({ status: 51, stdout: '' }))
    expect(await codeOf(loadAccount({ dir }))).toBe('KEYCHAIN_FAILED')
    // A timeout or a tool that cannot start has no exit status.
    security.force(() => ({ status: null, stdout: '' }))
    expect(await codeOf(loadAccount({ dir }))).toBe('KEYCHAIN_FAILED')
  })

  it('fails with ADDRESS_MISMATCH when the Keychain entry holds another key', async () => {
    const account = generateAccount()
    const other = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'keychain' })
    security.entries.set(keyEntry(stored.path), other.privateKey)
    const error = await failure(loadAccount({ dir }))
    expect(error.code).toBe('ADDRESS_MISMATCH')
    expect(error.message).toContain(account.address)
    expect(error.message).toContain(other.address)
    expect(error.message.includes(other.privateKey)).toBe(false)
  })

  it('writes no file when the Keychain write fails', async () => {
    security.force((args) => (args[0] === '-i' ? { status: 1, stdout: '' } : undefined))
    expect(await codeOf(saveAccount(generateAccount(), { dir, storage: 'keychain' }))).toBe('KEYCHAIN_FAILED')
    expect(existsSync(join(dir, 'default.json'))).toBe(false)
  })

  it('fails when the entry does not hold the key after the write', async () => {
    security.force((args) => (args[0] === '-i' ? { status: 0, stdout: '' } : undefined))
    expect(await codeOf(saveAccount(generateAccount(), { dir, storage: 'keychain' }))).toBe('KEYCHAIN_FAILED')
    expect(existsSync(join(dir, 'default.json'))).toBe(false)
  })

  it('refuses Keychain storage outside macOS before anything is written', async () => {
    runtime.platform = 'linux'
    const account = generateAccount()
    const error = await failure(saveAccount(account, { dir, storage: 'keychain' }))
    expect(error.code).toBe('KEYCHAIN_UNAVAILABLE')
    expect(existsSync(dir)).toBe(false)
    expect(security.calls).toEqual([])

    await saveAccount(account, { dir })
    expect(await codeOf(protectAccount({ dir, storage: 'keychain' }))).toBe('KEYCHAIN_UNAVAILABLE')
    expect((await accountInfo({ dir }))?.storage).toBe('plaintext')
  })

  it('fails to load a keychain file outside macOS and never falls back', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir, storage: 'keychain' })
    runtime.platform = 'linux'
    security.calls.length = 0

    expect((await accountInfo({ dir }))?.storage).toBe('keychain')
    const error = await failure(loadAccount({ dir, legacyKey: account.privateKey }))
    expect(error.code).toBe('KEYCHAIN_UNAVAILABLE')
    expect(error.message).toMatch(/[Ee]xport/)
    expect(error.message).toMatch(/import/)
    expect(await codeOf(exportAccount({ dir }))).toBe('KEYCHAIN_UNAVAILABLE')
    expect(security.calls).toEqual([])

    // A key from the environment needs no Keychain; the file still checks it.
    process.env.ALEO_PRIVATE_KEY = account.privateKey
    expect((await loadAccount({ dir })).source).toBe('env')
  })
})

describe('protectAccount', () => {
  it('moves an account through every storage and removes each old secret', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir })

    // plaintext -> keychain
    let stored = await protectAccount({ dir, storage: 'keychain' })
    expect(stored).toEqual({ name: 'default', path: join(dir, 'default.json'), address: account.address, storage: 'keychain' })
    expect(readFileSync(stored.path, 'utf8').includes('APrivateKey1')).toBe(false)
    const keyEntryName = keyEntry(stored.path)
    expect(same(security.entries.get(keyEntryName)!, account.privateKey)).toBe(true)
    expect(same(await exportAccount({ dir }), account.privateKey)).toBe(true)

    // keychain -> encrypted, password saved: the key entry goes, the password entry appears.
    stored = await protectAccount({ dir, storage: 'encrypted', password: PASSWORD, savePassword: true, prompt: false })
    expect(stored.storage).toBe('encrypted')
    expect(security.entries.has(keyEntryName)).toBe(false)
    expect(security.entries.get(savedPasswordEntry(stored.path))).toBe(Buffer.from(PASSWORD, 'utf8').toString('hex'))
    expect(same(await exportAccount({ dir, prompt: false }), account.privateKey)).toBe(true)

    // encrypted -> plaintext: the saved password goes.
    stored = await protectAccount({ dir, storage: 'plaintext', prompt: false })
    expect(stored.storage).toBe('plaintext')
    expect(security.entries.size).toBe(0)
    expect(same(await exportAccount({ dir }), account.privateKey)).toBe(true)
    if (posix) expect(mode(stored.path)).toBe(0o600)
    expect(readdirSync(dir)).toEqual(['default.json'])
  })

  it('sets a new password and a new salt on an encrypted account', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD, savePassword: true })
    const before = JSON.parse(readFileSync(stored.path, 'utf8'))

    await protectAccount({ dir, storage: 'encrypted', password: PASSWORD, newPassword: OTHER_PASSWORD, prompt: false })
    const after = JSON.parse(readFileSync(stored.path, 'utf8'))
    expect(after.key.kdfParams.salt === before.key.kdfParams.salt).toBe(false)
    expect(after.key.ciphertext === before.key.ciphertext).toBe(false)
    // savePassword was not repeated, so the saved (old) password is gone.
    expect(security.entries.size).toBe(0)
    expect(await codeOf(exportAccount({ dir, password: PASSWORD }))).toBe('WRONG_PASSWORD')
    expect(same(await exportAccount({ dir, password: OTHER_PASSWORD }), account.privateKey)).toBe(true)
  })

  it('takes a replacement password from newPassword or the prompt only', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD })
    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD

    // The variable holds the current password and is not reused as the new one.
    expect(await codeOf(protectAccount({ dir, storage: 'encrypted' }))).toBe('PASSWORD_REQUIRED')
    expect(same(await exportAccount({ dir }), account.privateKey)).toBe(true)

    runtime.terminalAttached = () => true
    expect(await codeOf(protectAccount({ dir, storage: 'encrypted', prompt: false }))).toBe('PASSWORD_REQUIRED')
    answers.push(OTHER_PASSWORD, OTHER_PASSWORD)
    const rekeyed = await protectAccount({ dir, storage: 'encrypted', savePassword: true })
    expect(prompts).toHaveLength(2)
    expect(security.entries.get(savedPasswordEntry(rekeyed.path))).toBe(Buffer.from(OTHER_PASSWORD, 'utf8').toString('hex'))
    process.env.ALEO_ACCOUNT_PASSWORD = OTHER_PASSWORD
    expect(same(await exportAccount({ dir }), account.privateKey)).toBe(true)
  })

  it('sets the first password from newPassword, password, then the variable', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir })
    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    await protectAccount({ dir, storage: 'encrypted', prompt: false })
    delete process.env.ALEO_ACCOUNT_PASSWORD
    expect(same(await exportAccount({ dir, password: PASSWORD }), account.privateKey)).toBe(true)

    await protectAccount({ dir, storage: 'plaintext', password: PASSWORD })
    await protectAccount({ dir, storage: 'encrypted', password: PASSWORD, newPassword: OTHER_PASSWORD })
    expect(same(await exportAccount({ dir, password: OTHER_PASSWORD }), account.privateKey)).toBe(true)

    await protectAccount({ dir, storage: 'plaintext', password: OTHER_PASSWORD })
    expect(await codeOf(protectAccount({ dir, storage: 'encrypted', prompt: false }))).toBe('PASSWORD_REQUIRED')
    expect((await accountInfo({ dir }))?.storage).toBe('plaintext')
  })

  it('keeps the account usable when the current password is wrong', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD })
    const bytes = readFileSync(stored.path)
    expect(await codeOf(protectAccount({ dir, storage: 'plaintext', password: OTHER_PASSWORD }))).toBe('WRONG_PASSWORD')
    expect(readFileSync(stored.path).equals(bytes)).toBe(true)
  })

  it('returns without rewriting when the storage is already in place', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir })
    const before = statSync(stored.path)
    expect(await protectAccount({ dir, storage: 'plaintext' })).toEqual(stored)
    expect(statSync(stored.path).ino).toBe(before.ino)

    await protectAccount({ dir, storage: 'keychain' })
    security.calls.length = 0
    expect((await protectAccount({ dir, storage: 'keychain' })).storage).toBe('keychain')
    expect(security.calls).toEqual([])
  })

  it('does not move an account to none and needs a stored key', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir })
    const none = 'none' as unknown as 'plaintext'
    expect(await codeOf(protectAccount({ dir, storage: none }))).toBe('UNSUPPORTED_STORAGE')
    expect((await accountInfo({ dir }))?.storage).toBe('plaintext')

    await saveAccount(account, { dir, name: 'address-only', storage: 'none' })
    process.env.ALEO_PRIVATE_KEY = account.privateKey
    expect(await codeOf(protectAccount({ dir, name: 'address-only', storage: 'plaintext' }))).toBe('KEY_NOT_STORED')
    expect(await codeOf(protectAccount({ dir, name: 'absent', storage: 'plaintext' }))).toBe('ACCOUNT_NOT_FOUND')
  })

  it('keeps the old secret when the new storage cannot be written', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir })
    const bytes = readFileSync(stored.path)
    security.force((args) => (args[0] === '-i' ? { status: 1, stdout: '' } : undefined))
    expect(await codeOf(protectAccount({ dir, storage: 'keychain' }))).toBe('KEYCHAIN_FAILED')
    expect(readFileSync(stored.path).equals(bytes)).toBe(true)
  })

  it('puts the original file back when the new storage does not read back', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir })
    const bytes = readFileSync(stored.path)
    // The entry is looked for, written and confirmed, then disappears before the check.
    let finds = 0
    security.force((args) => {
      if (args[0] !== 'find-generic-password') return undefined
      finds += 1
      return finds >= 3 ? { status: 44, stdout: '' } : undefined
    })
    expect(await codeOf(protectAccount({ dir, storage: 'keychain' }))).toBe('KEYCHAIN_ITEM_NOT_FOUND')
    expect(readFileSync(stored.path).equals(bytes)).toBe(true)
    security.force(undefined)
    expect(same(await exportAccount({ dir }), account.privateKey)).toBe(true)
  })
})

describe('exportAccount', () => {
  it('returns the stored key and never reads the key variables', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir })
    process.env.ALEO_PRIVATE_KEY = generateAccount().privateKey
    expect(same(await exportAccount({ dir }), account.privateKey)).toBe(true)
  })

  it('fails when there is no file or no stored key', async () => {
    const account = generateAccount()
    process.env.ALEO_PRIVATE_KEY = account.privateKey
    expect(await codeOf(exportAccount({ dir }))).toBe('ACCOUNT_NOT_FOUND')
    await saveAccount(account, { dir, storage: 'none' })
    expect(await codeOf(exportAccount({ dir }))).toBe('KEY_NOT_STORED')
  })
})

describe('migrateAccount', () => {
  const legacyText = (field: string, key: string) =>
    `${JSON.stringify({ address: 'placeholder', [field]: key, apiUrl: 'https://example.test', accessRedeemed: true, nested: { b: 1, a: [1, 2] } }, null, 2)}\n`

  it.each(['privateKey', 'private_key'])('copies the %s field into an account file and keeps the legacy file', async (field) => {
    const account = generateAccount()
    const from = join(root, 'state.json')
    writeFileSync(from, legacyText(field, account.privateKey), { mode: 0o600 })
    const before = readFileSync(from)

    const migrated = await migrateAccount({ from, dir })
    expect(migrated).toEqual({
      name: 'default',
      path: join(dir, 'default.json'),
      address: account.address,
      storage: 'plaintext',
      legacyKeyRemoved: false,
    })
    expect(readFileSync(from).equals(before)).toBe(true)
    expect(same(await exportAccount({ dir }), account.privateKey)).toBe(true)
  })

  it('strips the key field and keeps the other fields, their order and the indentation', async () => {
    const account = generateAccount()
    const from = join(root, 'state.json')
    writeFileSync(from, legacyText('privateKey', account.privateKey), { mode: 0o644 })

    const migrated = await migrateAccount({ from, dir, storage: 'encrypted', password: PASSWORD, removeLegacyKey: true })
    expect(migrated.legacyKeyRemoved).toBe(true)
    expect(migrated.storage).toBe('encrypted')
    const expected = `${JSON.stringify({ address: 'placeholder', apiUrl: 'https://example.test', accessRedeemed: true, nested: { b: 1, a: [1, 2] } }, null, 2)}\n`
    expect(readFileSync(from, 'utf8')).toBe(expected)
    if (posix) expect(mode(from)).toBe(0o600)
    expect(readdirSync(root).sort()).toEqual(['accounts', 'home', 'state.json'])
    expect(same(await exportAccount({ dir, password: PASSWORD }), account.privateKey)).toBe(true)

    // The key is gone, so a second run finds nothing to migrate.
    expect(await codeOf(migrateAccount({ from, dir }))).toBe('LEGACY_KEY_NOT_FOUND')
  })

  it('keeps four-space, tab and single-line layouts', async () => {
    const account = generateAccount()
    const content = { network: 'testnet', private_key: account.privateKey, endpoint: 'https://example.test' }
    const rest = { network: 'testnet', endpoint: 'https://example.test' }
    const cases: Array<[string, string]> = [
      [JSON.stringify(content, null, 4), JSON.stringify(rest, null, 4)],
      [`${JSON.stringify(content, null, '\t')}\n`, `${JSON.stringify(rest, null, '\t')}\n`],
      [JSON.stringify(content), JSON.stringify(rest)],
    ]
    for (const [index, [before, after]] of cases.entries()) {
      const from = join(root, `profile-${index}.json`)
      writeFileSync(from, before, { mode: 0o600 })
      const migrated = await migrateAccount({ from, dir, removeLegacyKey: true })
      expect(migrated.legacyKeyRemoved).toBe(true)
      expect(readFileSync(from, 'utf8')).toBe(after)
    }
  })

  it('follows the rules of saveAccount for an existing account file', async () => {
    const account = generateAccount()
    const from = join(root, 'state.json')
    writeFileSync(from, legacyText('privateKey', account.privateKey), { mode: 0o600 })

    await saveAccount(generateAccount(), { dir })
    expect(await codeOf(migrateAccount({ from, dir, removeLegacyKey: true }))).toBe('ACCOUNT_EXISTS')
    expect(readFileSync(from, 'utf8').includes(account.privateKey)).toBe(true)

    await saveAccount(account, { dir, name: 'mine' })
    expect(await codeOf(migrateAccount({ from, dir, name: 'mine', storage: 'keychain' }))).toBe('ACCOUNT_EXISTS')
    const migrated = await migrateAccount({ from, dir, name: 'mine', removeLegacyKey: true })
    expect(migrated.legacyKeyRemoved).toBe(true)
    expect(readFileSync(from, 'utf8').includes(account.privateKey)).toBe(false)
  })

  it('keeps the legacy key when the new account does not read back', async () => {
    const account = generateAccount()
    const from = join(root, 'state.json')
    writeFileSync(from, legacyText('privateKey', account.privateKey), { mode: 0o600 })
    let finds = 0
    security.force((args) => {
      if (args[0] !== 'find-generic-password') return undefined
      finds += 1
      return finds >= 3 ? { status: 44, stdout: '' } : undefined
    })
    expect(await codeOf(migrateAccount({ from, dir, storage: 'keychain', removeLegacyKey: true }))).toBe('KEYCHAIN_ITEM_NOT_FOUND')
    expect(readFileSync(from, 'utf8').includes(account.privateKey)).toBe(true)
  })

  it('does not strip the legacy key for an address-only account', async () => {
    const account = generateAccount()
    const from = join(root, 'state.json')
    writeFileSync(from, legacyText('privateKey', account.privateKey), { mode: 0o600 })
    expect(await codeOf(migrateAccount({ from, dir, storage: 'none', removeLegacyKey: true }))).toBe('KEY_NOT_STORED')
    expect(existsSync(dir)).toBe(false)
    expect((await migrateAccount({ from, dir, storage: 'none' })).storage).toBe('none')
    expect(readFileSync(from, 'utf8').includes(account.privateKey)).toBe(true)
  })

  it.each([
    ['a missing file', undefined],
    ['text that is not JSON', '{"privateKey": "APrivateKey1'],
    ['an array', '[]'],
    ['a file without a key field', '{"address": "aleo1x"}'],
    ['an empty key field', '{"privateKey": ""}'],
    ['a nested key field', '{"account": {"privateKey": "APrivateKey1x"}}'],
    ['a key field that is not a string', '{"private_key": 7}'],
  ])('fails with LEGACY_KEY_NOT_FOUND for %s', async (_label, content) => {
    const from = join(root, 'state.json')
    if (content !== undefined) writeFileSync(from, content, { mode: 0o600 })
    const error = await failure(migrateAccount({ from, dir }))
    expect(error.code).toBe('LEGACY_KEY_NOT_FOUND')
    expect(error.message).toContain(from)
    expect(error.message.includes('APrivateKey1')).toBe(false)
    expect(existsSync(dir)).toBe(false)
  })

  it('fails with INVALID_KEY for a key that cannot be parsed', async () => {
    const from = join(root, 'state.json')
    writeFileSync(from, '{"privateKey": "APrivateKey1nope"}', { mode: 0o600 })
    expect(await codeOf(migrateAccount({ from, dir }))).toBe('INVALID_KEY')
  })
})

describe('storing a new account never replaces a file', () => {
  it('creates a file exclusively and leaves an existing one untouched', async () => {
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'exclusive.json')
    await writeFileExclusive(path, 'first')
    const error = await writeFileExclusive(path, 'second').then(
      () => undefined,
      (cause: unknown) => cause as { code?: string },
    )
    expect(error?.code).toBe('EEXIST')
    expect(readFileSync(path, 'utf8')).toBe('first')
    if (posix) expect(mode(path)).toBe(0o600)
    // No temporary file is left behind by either call.
    expect(readdirSync(dir)).toEqual(['exclusive.json'])
  })

  it('refuses when another account appears under the name while the password is being asked for', async () => {
    const mine = generateAccount()
    const theirs = generateAccount()
    runtime.terminalAttached = () => true
    runtime.promptHidden = async () => {
      // Another process stores a different account under the same name.
      if (!existsSync(join(dir, 'default.json'))) {
        put('default', { version: 1, address: theirs.address, key: { type: 'plaintext', privateKey: theirs.privateKey } })
      }
      return PASSWORD
    }
    const error = await failure(saveAccount(mine, { dir, storage: 'encrypted', savePassword: true }))
    expect(error.code).toBe('ACCOUNT_EXISTS')
    expect(error.message).toContain(mine.address)
    // The other account is intact, and nothing of this one is left behind.
    expect(same(await exportAccount({ dir }), theirs.privateKey)).toBe(true)
    expect(security.entries.size).toBe(0)
    expect(readdirSync(dir)).toEqual(['default.json'])
  })

  it('removes the Keychain entry it wrote when another account takes the name first', async () => {
    const mine = generateAccount()
    const theirs = generateAccount()
    security.force((args) => {
      // The other account appears between the existence check and the write.
      if (args[0] === '-i' && !existsSync(join(dir, 'default.json'))) {
        put('default', { version: 1, address: theirs.address, key: { type: 'plaintext', privateKey: theirs.privateKey } })
      }
      return undefined
    })
    expect(await codeOf(saveAccount(mine, { dir, storage: 'keychain' }))).toBe('ACCOUNT_EXISTS')
    expect(security.entries.size).toBe(0)
    expect(same(await exportAccount({ dir }), theirs.privateKey)).toBe(true)
  })

  it('accepts the same account in the same storage stored by another process meanwhile', async () => {
    const account = generateAccount()
    const theirEntry = `${account.address}-${'ab'.repeat(16)}`
    security.force((args) => {
      // The other process stores the same account, with a Keychain entry of its own.
      if (args[0] === '-i' && !existsSync(join(dir, 'default.json'))) {
        security.entries.set(`${KEY_SERVICE} ${theirEntry}`, account.privateKey)
        put('default', { version: 1, address: account.address, key: { type: 'keychain', service: KEY_SERVICE, account: theirEntry } })
      }
      return undefined
    })
    const stored = await saveAccount(account, { dir, storage: 'keychain' })
    expect(stored).toEqual({ name: 'default', path: join(dir, 'default.json'), address: account.address, storage: 'keychain' })
    // The entry made for the file that was never created is gone; the winner's is untouched.
    expect([...security.entries.keys()]).toEqual([`${KEY_SERVICE} ${theirEntry}`])
    security.force(undefined)
    expect(same(await exportAccount({ dir }), account.privateKey)).toBe(true)
  })

  it('removes the Keychain entry when the account file cannot be created', async () => {
    const account = generateAccount()
    // A file where the accounts directory should be makes the write fail.
    writeFileSync(dir, 'not a directory')
    await expect(saveAccount(account, { dir, storage: 'keychain' })).rejects.toThrow()
    expect(security.entries.size).toBe(0)
  })
})

describe('protectAccount rollback', () => {
  it('removes the new Keychain entry when the new storage does not read back', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir })
    const bytes = readFileSync(stored.path)
    let finds = 0
    security.force((args) => {
      if (args[0] !== 'find-generic-password') return undefined
      finds += 1
      // The write is confirmed, then the read-back sees another key.
      return finds >= 3 ? { status: 0, stdout: `${generateAccount().privateKey}\n` } : undefined
    })
    expect(await codeOf(protectAccount({ dir, storage: 'keychain' }))).toBe('ADDRESS_MISMATCH')
    expect(readFileSync(stored.path).equals(bytes)).toBe(true)
    expect(security.entries.has(`${KEY_SERVICE} ${account.address}`)).toBe(false)
  })

  it('goes back to the original file when the new password cannot be saved', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD, savePassword: true })
    const bytes = readFileSync(stored.path)
    // Reading the saved password works; writing the new one does not.
    security.force((args) => (args[0] === '-i' ? { status: 1, stdout: '' } : undefined))
    expect(
      await codeOf(protectAccount({ dir, storage: 'encrypted', newPassword: OTHER_PASSWORD, savePassword: true, prompt: false })),
    ).toBe('KEYCHAIN_FAILED')
    security.force(undefined)
    expect(readFileSync(stored.path).equals(bytes)).toBe(true)
    // The original saved password is untouched, so an unattended load still works.
    expect(security.entries.get(savedPasswordEntry(stored.path))).toBe(Buffer.from(PASSWORD, 'utf8').toString('hex'))
    expect(security.entries.size).toBe(1)
    expect(same(await exportAccount({ dir, prompt: false }), account.privateKey)).toBe(true)
    expect(await codeOf(exportAccount({ dir, password: OTHER_PASSWORD, prompt: false }))).toBe('WRONG_PASSWORD')
  })

  it('keeps the encrypted file when the saved password cannot be removed', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'encrypted', password: PASSWORD, savePassword: true })
    const bytes = readFileSync(stored.path)
    security.force((args) => (args[0] === 'delete-generic-password' ? { status: 1, stdout: '' } : undefined))
    expect(await codeOf(protectAccount({ dir, storage: 'plaintext', prompt: false }))).toBe('KEYCHAIN_FAILED')
    security.force(undefined)
    // Still encrypted, and the saved password still unlocks it.
    expect(readFileSync(stored.path).equals(bytes)).toBe(true)
    expect(same(await exportAccount({ dir, prompt: false }), account.privateKey)).toBe(true)
  })

  it('keeps the Keychain key until a move out of the Keychain has fully succeeded', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'keychain' })
    const bytes = readFileSync(stored.path)
    // Saving the password of the new encrypted file fails.
    security.force((args) => (args[0] === '-i' ? { status: 1, stdout: '' } : undefined))
    expect(
      await codeOf(protectAccount({ dir, storage: 'encrypted', password: PASSWORD, savePassword: true, prompt: false })),
    ).toBe('KEYCHAIN_FAILED')
    security.force(undefined)
    expect(readFileSync(stored.path).equals(bytes)).toBe(true)
    expect(same(await exportAccount({ dir }), account.privateKey)).toBe(true)
  })
})

describe('migrateAccount with both key fields', () => {
  const both = (first: string, second: string) =>
    `${JSON.stringify({ address: 'placeholder', privateKey: first, network: 'testnet', private_key: second, endpoint: 'https://example.test' }, null, 2)}\n`

  it('removes both fields when they hold the same key', async () => {
    const account = generateAccount()
    const from = join(root, 'state.json')
    writeFileSync(from, both(account.privateKey, account.privateKey), { mode: 0o600 })
    const migrated = await migrateAccount({ from, dir, removeLegacyKey: true })
    expect(migrated.legacyKeyRemoved).toBe(true)
    expect(readFileSync(from, 'utf8')).toBe(
      `${JSON.stringify({ address: 'placeholder', network: 'testnet', endpoint: 'https://example.test' }, null, 2)}\n`,
    )
    expect(same(await exportAccount({ dir }), account.privateKey)).toBe(true)
  })

  it('refuses a file whose two fields hold different keys', async () => {
    const first = generateAccount()
    const second = generateAccount()
    const from = join(root, 'state.json')
    const text = both(first.privateKey, second.privateKey)
    writeFileSync(from, text, { mode: 0o600 })
    for (const removeLegacyKey of [false, true]) {
      const error = await failure(migrateAccount({ from, dir, removeLegacyKey }))
      expect(error.code).toBe('KEY_CONFLICT')
      expect(error.message).toContain(first.address)
      expect(error.message).toContain(second.address)
      expect(error.message.includes('APrivateKey1')).toBe(false)
    }
    expect(readFileSync(from, 'utf8')).toBe(text)
    expect(existsSync(dir)).toBe(false)
  })

  it('fails with INVALID_KEY when the second field is not a key', async () => {
    const from = join(root, 'state.json')
    writeFileSync(from, both(generateAccount().privateKey, 'APrivateKey1nope'), { mode: 0o600 })
    expect(await codeOf(migrateAccount({ from, dir }))).toBe('INVALID_KEY')
    expect(existsSync(dir)).toBe(false)
  })
})

describe('Keychain entries shared between account files', () => {
  it("leaves another account file's key alone when a later save of the same account fails", async () => {
    const account = generateAccount()
    const original = await saveAccount(account, { dir, name: 'original', storage: 'keychain' })
    // The same account is saved again where the file cannot be created.
    const blocked = join(root, 'blocked')
    writeFileSync(blocked, 'not a directory')
    await expect(saveAccount(account, { dir: blocked, name: 'copy', storage: 'keychain' })).rejects.toThrow()
    // The failed save made and removed an entry of its own; the original's is untouched.
    expect([...security.entries.keys()]).toEqual([keyEntry(original.path)])
    expect(same(await exportAccount({ dir, name: 'original' }), account.privateKey)).toBe(true)
  })

  it('does not let a failed save remove the key of a save that succeeds alongside it', async () => {
    const account = generateAccount()
    let other: Promise<unknown> | undefined
    security.force((args) => {
      // Once the first save is writing its Keychain entry, a second save of the
      // same account starts, and the first one's file can then no longer be created.
      if (args[0] === '-i' && other === undefined) {
        other = saveAccount(account, { dir, name: 'b', storage: 'keychain' })
        mkdirSync(join(dir, 'a.json'), { recursive: true })
      }
      return undefined
    })
    await expect(saveAccount(account, { dir, name: 'a', storage: 'keychain' })).rejects.toThrow()
    await other
    security.force(undefined)
    // Neither save can adopt the other's entry, so the failed one removes only its own.
    expect([...security.entries.keys()]).toEqual([keyEntry(join(dir, 'b.json'))])
    expect(same(await exportAccount({ dir, name: 'b' }), account.privateKey)).toBe(true)
  })

  it('gives two account files for one account separate key entries', async () => {
    const account = generateAccount()
    const first = await saveAccount(account, { dir, name: 'first', storage: 'keychain' })
    const second = await saveAccount(account, { dir, name: 'second', storage: 'keychain' })
    expect(keyEntry(first.path) === keyEntry(second.path)).toBe(false)
    expect(security.entries.size).toBe(2)
    expect(security.labels.get(keyEntry(first.path))).toBe('aleo-account-key:first')
    expect(security.labels.get(keyEntry(second.path))).toBe('aleo-account-key:second')
  })

  it('removes only its own key entry when one of two files for an account leaves the Keychain', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir, name: 'first', storage: 'keychain' })
    const second = await saveAccount(account, { dir, name: 'second', storage: 'keychain' })
    await protectAccount({ dir, name: 'first', storage: 'plaintext' })
    expect([...security.entries.keys()]).toEqual([keyEntry(second.path)])
    expect(same(await exportAccount({ dir, name: 'second' }), account.privateKey)).toBe(true)
    await protectAccount({ dir, name: 'second', storage: 'plaintext' })
    expect(security.entries.size).toBe(0)
  })

  it('leaves the same account in another directory working when one leaves the Keychain', async () => {
    const account = generateAccount()
    const elsewhere = join(root, 'other-project')
    await saveAccount(account, { dir, storage: 'keychain' })
    const other = await saveAccount(account, { dir: elsewhere, storage: 'keychain' })
    await protectAccount({ dir, storage: 'plaintext' })
    // The other directory's file has its own entry, which nothing here touched.
    expect([...security.entries.keys()]).toEqual([keyEntry(other.path)])
    expect(same(await exportAccount({ dir: elsewhere }), account.privateKey)).toBe(true)
  })

  it('keeps the key entry while a copy of the Keychain account file remains beside it', async () => {
    const account = generateAccount()
    const original = await saveAccount(account, { dir, name: 'original', storage: 'keychain' })
    writeFileSync(join(dir, 'copy.json'), readFileSync(original.path), { mode: 0o600 })
    await protectAccount({ dir, name: 'original', storage: 'plaintext' })
    // The copy points at the same entry, so it still finds the key.
    expect(same(await exportAccount({ dir, name: 'copy' }), account.privateKey)).toBe(true)
    await protectAccount({ dir, name: 'copy', storage: 'plaintext' })
    expect(security.entries.size).toBe(0)
  })

  it('keeps the key of a neighbouring file when a failed move into the Keychain is undone', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir, name: 'first', storage: 'keychain' })
    const second = await saveAccount(account, { dir, name: 'second' })
    const bytes = readFileSync(second.path)
    let finds = 0
    security.force((args) => {
      if (args[0] !== 'find-generic-password') return undefined
      finds += 1
      // The existing entry is seen, then the read-back fails.
      return finds >= 2 ? { status: 51, stdout: '' } : undefined
    })
    expect(await codeOf(protectAccount({ dir, name: 'second', storage: 'keychain' }))).toBe('KEYCHAIN_FAILED')
    security.force(undefined)
    expect(readFileSync(second.path).equals(bytes)).toBe(true)
    expect(same(await exportAccount({ dir, name: 'first' }), account.privateKey)).toBe(true)
  })

  it('gives each encrypted file its own saved password', async () => {
    const account = generateAccount()
    const first = await saveAccount(account, { dir, name: 'first', storage: 'encrypted', password: PASSWORD, savePassword: true })
    const second = await saveAccount(account, { dir, name: 'second', storage: 'encrypted', password: OTHER_PASSWORD, savePassword: true })
    expect(savedPasswordEntry(first.path) === savedPasswordEntry(second.path)).toBe(false)
    expect(security.entries.size).toBe(2)
    // Both open unattended, each with its own password.
    for (const name of ['first', 'second']) {
      expect(same(await exportAccount({ dir, name, prompt: false }), account.privateKey)).toBe(true)
    }
    // Changing one file's password leaves the other's saved password alone.
    await protectAccount({ dir, name: 'first', storage: 'encrypted', newPassword: 'a third test password', prompt: false })
    expect(security.entries.size).toBe(1)
    expect(same(await exportAccount({ dir, name: 'second', prompt: false }), account.privateKey)).toBe(true)
  })

  it('does not consult the saved password of another file for the same address', async () => {
    const account = generateAccount()
    await saveAccount(account, { dir, name: 'saved', storage: 'encrypted', password: PASSWORD, savePassword: true })
    await saveAccount(account, { dir, name: 'unsaved', storage: 'encrypted', password: OTHER_PASSWORD })
    // No saved password of its own: the load asks for one instead of failing on the neighbour's.
    expect(await codeOf(loadAccount({ dir, name: 'unsaved', prompt: false }))).toBe('PASSWORD_REQUIRED')
    runtime.terminalAttached = () => true
    answers.push(OTHER_PASSWORD)
    expect((await loadAccount({ dir, name: 'unsaved' })).account.address).toBe(account.address)
  })

  it('keeps the saved password while a copy of the encrypted file remains', async () => {
    const account = generateAccount()
    const original = await saveAccount(account, { dir, name: 'original', storage: 'encrypted', password: PASSWORD, savePassword: true })
    writeFileSync(join(dir, 'copy.json'), readFileSync(original.path), { mode: 0o600 })
    await protectAccount({ dir, name: 'original', storage: 'plaintext', prompt: false })
    // The copy has the same salt, so it still finds the saved password.
    expect(same(await exportAccount({ dir, name: 'copy', prompt: false }), account.privateKey)).toBe(true)
    await protectAccount({ dir, name: 'copy', storage: 'plaintext', prompt: false })
    expect(security.entries.size).toBe(0)
  })

  it('goes back to Keychain storage when the old key cannot be removed', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'keychain' })
    const bytes = readFileSync(stored.path)
    security.force((args) => (args[0] === 'delete-generic-password' ? { status: 1, stdout: '' } : undefined))
    expect(await codeOf(protectAccount({ dir, storage: 'plaintext' }))).toBe('KEYCHAIN_FAILED')
    security.force(undefined)
    // The rejected operation left the account exactly as it was.
    expect(readFileSync(stored.path).equals(bytes)).toBe(true)
    expect((await accountInfo({ dir }))?.storage).toBe('keychain')
    expect(same(await exportAccount({ dir }), account.privateKey)).toBe(true)
  })

  it('removes the new saved password when a move to encrypted storage is undone', async () => {
    const account = generateAccount()
    const stored = await saveAccount(account, { dir, storage: 'keychain' })
    const bytes = readFileSync(stored.path)
    // The new file and its saved password are written, then the old key cannot be removed.
    security.force((args) => (args[0] === 'delete-generic-password' && args[2] === KEY_SERVICE ? { status: 1, stdout: '' } : undefined))
    expect(
      await codeOf(protectAccount({ dir, storage: 'encrypted', password: PASSWORD, savePassword: true, prompt: false })),
    ).toBe('KEYCHAIN_FAILED')
    security.force(undefined)
    expect(readFileSync(stored.path).equals(bytes)).toBe(true)
    // Only the original key entry is left.
    expect([...security.entries.keys()]).toEqual([keyEntry(stored.path)])
  })
})

describe('hidden prompt', () => {
  /** A terminal stand-in that records raw-mode changes. */
  class FakeTerminal extends EventEmitter {
    isRaw = false
    rawModes: boolean[] = []
    paused = true
    setRawMode(value: boolean) {
      this.isRaw = value
      this.rawModes.push(value)
      return this
    }
    resume() {
      this.paused = false
      return this
    }
    pause() {
      this.paused = true
      return this
    }
  }

  it('reads a line without echoing it and restores the terminal', async () => {
    const input = new FakeTerminal()
    const written: string[] = []
    const pending = readHidden(input, { write: (text) => written.push(text) }, 'Password: ')
    expect(input.rawModes).toEqual([true])
    expect(input.paused).toBe(false)
    input.emit('data', Buffer.from('sec'))
    input.emit('data', Buffer.from('rx\u007fet\r'))
    expect(await pending).toBe('secret')
    expect(written).toEqual(['Password: ', '\n'])
    expect(input.rawModes).toEqual([true, false])
    expect(input.paused).toBe(true)
    expect(input.listenerCount('data')).toBe(0)
  })

  it('handles multi-byte input split across chunks and Ctrl-U', async () => {
    const input = new FakeTerminal()
    const pending = readHidden(input, { write: () => undefined }, '')
    const bytes = Buffer.from('ab\u0015pé\n')
    input.emit('data', bytes.subarray(0, 5))
    input.emit('data', bytes.subarray(5))
    expect(await pending).toBe('pé')
  })

  it('fails with PASSWORD_REQUIRED when cancelled or when the input ends', async () => {
    const cancelled = new FakeTerminal()
    const first = readHidden(cancelled, { write: () => undefined }, '')
    cancelled.emit('data', Buffer.from('abc\u0003'))
    expect(await codeOf(first)).toBe('PASSWORD_REQUIRED')
    expect(cancelled.rawModes).toEqual([true, false])

    const ended = new FakeTerminal()
    const second = readHidden(ended, { write: () => undefined }, '')
    ended.emit('end')
    expect(await codeOf(second)).toBe('PASSWORD_REQUIRED')
  })
})

/**
 * Exercises the real macOS Keychain. Skipped unless
 * `ALEO_KEYSTORE_KEYCHAIN_TEST=1` on macOS. Uses the public sample account
 * only and deletes both of its entries afterwards.
 */
describe.skipIf(process.env.ALEO_KEYSTORE_KEYCHAIN_TEST !== '1' || process.platform !== 'darwin')(
  'real macOS Keychain',
  () => {
    it('stores, reads and removes the sample account through /usr/bin/security', async () => {
      // Undo the stand-ins for this test only.
      runtime.platform = savedRuntime.platform
      runtime.security = savedRuntime.security
      // Every entry is named after its own file, so each one this test makes is
      // recorded, checked and removed. Nothing here can touch another run's entries.
      const made: Array<{ service: string; account: string }> = []
      const leftovers = async () => Promise.all(made.map((entry) => readKeychain(entry.service, entry.account)))
      try {
        const stored = await saveAccount(SAMPLE, { dir, name: 'keychain', storage: 'keychain' })
        made.push({ service: KEY_SERVICE, account: keyEntryAccount(stored.path) })
        const loaded = await loadAccount({ dir, name: 'keychain', prompt: false })
        expect(loaded.source).toBe('account-file')
        expect(loaded.account.address).toBe(SAMPLE.address)
        expect(same(loaded.account.privateKey, SAMPLE.privateKey)).toBe(true)

        // Move to an encrypted file with the password saved: the key entry goes.
        const encrypted = await protectAccount({
          dir,
          name: 'keychain',
          storage: 'encrypted',
          password: vectors.encrypted.password,
          savePassword: true,
          prompt: false,
        })
        made.push({ service: PASSWORD_SERVICE, account: savedPasswordAccount(encrypted.path) })
        expect(await readKeychain(made[0]!.service, made[0]!.account)).toBeUndefined()
        expect(await readKeychain(made[1]!.service, made[1]!.account)).toBe(vectors.keychain.passwordValue)
        expect(same(await exportAccount({ dir, name: 'keychain', prompt: false }), SAMPLE.privateKey)).toBe(true)

        // Back to plaintext: the saved password goes too.
        await protectAccount({ dir, name: 'keychain', storage: 'plaintext', prompt: false })
        expect((await leftovers()).every((value) => value === undefined)).toBe(true)
      } finally {
        for (const entry of made) await deleteKeychain(entry.service, entry.account)
      }
      expect((await leftovers()).every((value) => value === undefined)).toBe(true)
    })
  },
)
