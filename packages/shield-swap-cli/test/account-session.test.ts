import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PASSWORD, mode, openSandbox, posix, type Sandbox } from './account-sandbox.js'

/**
 * Tests account lookup, setup, and saved session state.
 *
 * Uses temporary files and mocked terminal and Keychain access from
 * `account-sandbox.ts`. Replaces DEX authentication to keep session tests
 * independent of the network.
 */

vi.setConfig({ testTimeout: 60_000 })

let sandbox: Sandbox
let session: typeof import('../src/session.js')
let lookup: typeof import('../src/account-lookup.js')

beforeEach(async () => {
  sandbox = await openSandbox()
  // Mock DEX authentication while exercising account lookup and client creation.
  vi.doMock('@provablehq/shield-swap-sdk', async () => ({
    ...(await vi.importActual<object>('@provablehq/shield-swap-sdk')),
    shieldSwapActions: () => () => ({ authenticateShieldSwap: async () => undefined }),
  }))
  session = await import('../src/session.js')
  lookup = await import('../src/account-lookup.js')
})

afterEach(() => {
  vi.doUnmock('@provablehq/shield-swap-sdk')
  vi.doUnmock('../src/session.js')
  sandbox.close()
})

function newAccount(): { address: string; privateKey: string } {
  return sandbox.sdk.generateAccount()
}

function statePath(network = 'testnet'): string {
  return join(sandbox.stateRoot, network, 'state.json')
}

function readState(network = 'testnet'): Record<string, unknown> {
  return JSON.parse(readFileSync(statePath(network), 'utf8'))
}

/** Writes a state file containing the fallback key for account lookup. */
function legacyState(owner: { address: string; privateKey: string }, network = 'testnet'): void {
  mkdirSync(dirname(statePath(network)), { recursive: true })
  writeFileSync(
    statePath(network),
    JSON.stringify({ network, privateKey: owner.privateKey, address: owner.address, dexApiToken: 'ss_test' }, null, 2),
    { mode: 0o600 },
  )
}

/** Searches test files recursively for secret text without printing it. */
function onDisk(directory: string, secret: string): boolean {
  if (!existsSync(directory)) return false
  return readdirSync(directory, { recursive: true, withFileTypes: true }).some(
    (entry) => entry.isFile() && readFileSync(join(entry.parentPath, entry.name), 'utf8').includes(secret),
  )
}

/** Collects captured console.error calls as lines of text. */
function stderr(): string[] {
  return vi.mocked(console.error).mock.calls.map((parts) => parts.map(String).join(' '))
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call
  } catch (error) {
    if (error instanceof sandbox.keystore.KeystoreError) return error.code
    throw error
  }
  throw new Error('expected the call to fail')
}

describe('saveState', () => {
  it('writes the state for its owner only, through a temporary file created at that mode', () => {
    mkdirSync(dirname(statePath()), { recursive: true })
    // Simulate an interrupted write that left a temporary file with mode 0644.
    writeFileSync(`${statePath()}.tmp`, 'stale', { mode: 0o644 })
    session.saveState({ network: 'testnet', address: 'aleo1example', account: 'default', dexApiToken: 'ss_test' })
    expect(readState()).toEqual({ network: 'testnet', address: 'aleo1example', account: 'default', dexApiToken: 'ss_test' })
    expect(existsSync(`${statePath()}.tmp`)).toBe(false)
    if (posix) expect(mode(statePath())).toBe(0o600)
  })
})

describe('ensureKeyMaterial', () => {
  it('stops for a decision when no key is found and none may be generated', async () => {
    await expect(session.ensureKeyMaterial(session.loadState('testnet'))).rejects.toBeInstanceOf(
      session.NeedsConfigDecisionError,
    )
    expect(existsSync(sandbox.dir)).toBe(false)
    expect(existsSync(statePath())).toBe(false)
  })

  it('generates an account into an account file, and keeps the key out of the state', async () => {
    const state = await session.ensureKeyMaterial(session.loadState('testnet'), { allowGenerate: true })
    const stored = await sandbox.keystore.accountInfo()
    expect(stored).toMatchObject({ name: 'default', storage: 'plaintext', address: state.address })
    expect(readState()).toEqual({ network: 'testnet', address: stored!.address, account: 'default' })
    const key = await sandbox.keystore.exportAccount()
    expect(onDisk(sandbox.stateRoot, key)).toBe(false)
    if (posix) {
      expect(mode(stored!.path)).toBe(0o600)
      expect(mode(statePath())).toBe(0o600)
    }

    // Repeated setup must reuse the stored account.
    const before = readFileSync(stored!.path)
    const again = await session.ensureKeyMaterial(session.loadState('testnet'), { allowGenerate: true })
    expect(again.address).toBe(state.address)
    expect(readFileSync(stored!.path).equals(before)).toBe(true)
  })

  it('stores a generated account under the given name and records the name', async () => {
    const state = await session.ensureKeyMaterial(session.loadState('testnet'), { allowGenerate: true, name: 'trading' })
    expect(state.account).toBe('trading')
    expect((await sandbox.keystore.accountInfo({ name: 'trading' }))?.address).toBe(state.address)
    expect(await sandbox.keystore.accountInfo()).toBeUndefined()
    expect(readState().account).toBe('trading')
  })

  it('imports a key into the account file', async () => {
    const owner = newAccount()
    const state = await session.ensureKeyMaterial(session.loadState('testnet'), { importKey: owner.privateKey })
    expect(state.address).toBe(owner.address)
    expect((await sandbox.keystore.exportAccount()) === owner.privateKey).toBe(true)
    expect(readState()).toEqual({ network: 'testnet', address: owner.address, account: 'default' })
    expect(onDisk(sandbox.stateRoot, owner.privateKey)).toBe(false)
  })

  it('accepts an import of the account that is already stored, however it is stored', async () => {
    const owner = newAccount()
    await sandbox.keystore.saveAccount(owner, { storage: 'encrypted', password: PASSWORD })
    process.env.ALEO_ACCOUNT_PASSWORD = PASSWORD
    const state = await session.ensureKeyMaterial(session.loadState('testnet'), { importKey: owner.privateKey })
    expect(state.address).toBe(owner.address)
    expect((await sandbox.keystore.accountInfo())?.storage).toBe('encrypted')
  })

  it('says that an address-only account file cannot take the imported key', async () => {
    const owner = newAccount()
    const existing = await sandbox.keystore.saveAccount(owner, { storage: 'none' })
    const before = readFileSync(existing.path)
    const call = session.ensureKeyMaterial(session.loadState('testnet'), { importKey: owner.privateKey })
    await expect(call).rejects.toMatchObject({ code: 'KEY_NOT_STORED' })
    await expect(call).rejects.toThrow(`${existing.path} records the address ${owner.address} without a key`)
    await expect(call).rejects.toThrow('remove that file and import again')
    expect(readFileSync(existing.path).equals(before)).toBe(true)
    expect(existsSync(statePath())).toBe(false)
    expect(onDisk(sandbox.root, owner.privateKey)).toBe(false)
  })

  it('refuses to import another account than the one the state records', async () => {
    const owner = newAccount()
    await session.ensureKeyMaterial(session.loadState('testnet'), { importKey: owner.privateKey })
    await expect(
      session.ensureKeyMaterial(session.loadState('testnet'), { importKey: newAccount().privateKey, name: 'other' }),
    ).rejects.toThrow(`a DIFFERENT account is already configured here (${owner.address})`)
    expect(await sandbox.keystore.accountInfo({ name: 'other' })).toBeUndefined()
    expect(readState().address).toBe(owner.address)
  })

  it('refuses to import over an account file that holds another account', async () => {
    const existing = await sandbox.keystore.saveAccount(newAccount())
    const before = readFileSync(existing.path)
    expect(await codeOf(session.ensureKeyMaterial(session.loadState('testnet'), { importKey: newAccount().privateKey }))).toBe(
      'ACCOUNT_EXISTS',
    )
    expect(readFileSync(existing.path).equals(before)).toBe(true)
    expect(existsSync(statePath())).toBe(false)
  })

  it('reports an import that is not a key without repeating it', async () => {
    const call = session.ensureKeyMaterial(session.loadState('testnet'), { importKey: 'APrivateKey1nope' })
    await expect(call).rejects.toMatchObject({ code: 'INVALID_KEY' })
    await expect(call).rejects.not.toThrow('nope')
  })

  it('uses a key from the environment for the process and writes it nowhere', async () => {
    const owner = newAccount()
    process.env.ALEO_PRIVATE_KEY = owner.privateKey
    const state = await session.ensureKeyMaterial(session.loadState('testnet'))
    expect(state.address).toBe(owner.address)
    // An environment key without an account file supplies no saved account name.
    expect(readState()).toEqual({ network: 'testnet', address: owner.address })
    expect(existsSync(sandbox.dir)).toBe(false)
    expect(onDisk(sandbox.root, owner.privateKey)).toBe(false)

    // Removing the environment key must not generate a replacement account.
    delete process.env.ALEO_PRIVATE_KEY
    expect(await codeOf(session.ensureKeyMaterial(session.loadState('testnet'), { allowGenerate: true }))).toBe(
      'ACCOUNT_NOT_FOUND',
    )
    expect(existsSync(sandbox.dir)).toBe(false)
  })

  it('records the account file an environment key belongs to', async () => {
    const owner = newAccount()
    await sandbox.keystore.saveAccount(owner, { storage: 'none' })
    process.env.SHIELD_SWAP_PRIVATE_KEY = owner.privateKey
    const state = await session.ensureKeyMaterial(session.loadState('testnet'))
    expect(state).toMatchObject({ address: owner.address, account: 'default' })
    expect(onDisk(sandbox.root, owner.privateKey)).toBe(false)
  })

  it('records an explicit name for an environment key before its account file exists', async () => {
    const owner = newAccount()
    process.env.ALEO_PRIVATE_KEY = owner.privateKey
    await session.ensureKeyMaterial(session.loadState('testnet'), { name: 'trading' })
    expect(readState()).toEqual({ network: 'testnet', address: owner.address, account: 'trading' })
    expect(existsSync(sandbox.dir)).toBe(false)

    // Once the key is imported under that name, commands find it without the variable.
    await sandbox.keystore.saveAccount(owner, { name: 'trading' })
    delete process.env.ALEO_PRIVATE_KEY
    const loaded = await lookup.resolveAccount({ state: session.loadState('testnet') })
    expect(loaded.account.address).toBe(owner.address)
    expect(loaded.stored?.name).toBe('trading')
  })

  it('keeps a state file that still holds its key working, and points at migrate once', async () => {
    const owner = newAccount()
    legacyState(owner)
    const state = await session.ensureKeyMaterial(session.loadState('testnet'))
    expect(state.address).toBe(owner.address)
    // Account lookup preserves keys already stored in session state.
    expect(readState().privateKey === owner.privateKey).toBe(true)
    expect(readState().account).toBeUndefined()
    expect(existsSync(sandbox.dir)).toBe(false)
    const notices = stderr().filter((line) => line.includes('shield-swap account migrate'))
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain('--network testnet')
    expect(notices[0]!.includes(owner.privateKey)).toBe(false)

    // Cached lookups must not repeat the migration notice.
    await lookup.resolveAccount({ state: session.loadState('testnet') })
    expect(stderr().filter((line) => line.includes('shield-swap account migrate'))).toHaveLength(1)
  })

  it('preserves a key-only legacy state when an environment key belongs to another account', async () => {
    const owner = newAccount()
    const original = { network: 'testnet', privateKey: owner.privateKey, dexApiToken: 'ss_test' }
    session.saveState(original)
    const before = readFileSync(statePath())
    process.env.ALEO_PRIVATE_KEY = newAccount().privateKey

    const state = session.loadState('testnet')
    expect(await codeOf(session.ensureKeyMaterial(state))).toBe('ADDRESS_MISMATCH')
    expect(state).toEqual(original)
    expect(readFileSync(statePath()).equals(before)).toBe(true)

    // Retrying with the original key fills in the address without replacing credentials.
    delete process.env.ALEO_PRIVATE_KEY
    await session.ensureKeyMaterial(session.loadState('testnet'))
    expect(readState()).toEqual({ ...original, address: owner.address })
  })

  it('reads the account file once the legacy key is migrated, without a notice', async () => {
    const owner = newAccount()
    legacyState(owner)
    await sandbox.keystore.migrateAccount({ from: statePath() })
    const loaded = await lookup.resolveAccount({ state: session.loadState('testnet') })
    expect(loaded.source).toBe('account-file')
    expect(stderr()).toEqual([])

    // Reject a state key that conflicts with the selected account file.
    legacyState(newAccount(), 'mainnet')
    expect(await codeOf(lookup.resolveAccount({ state: session.loadState('mainnet') }))).toBe('ADDRESS_MISMATCH')
  })

  it('does not rewrite the recorded name for a one-off ALEO_ACCOUNT', async () => {
    const owner = newAccount()
    await sandbox.keystore.saveAccount(owner, { name: 'first' })
    await sandbox.keystore.saveAccount(owner, { name: 'second' })
    await session.ensureKeyMaterial(session.loadState('testnet'), { name: 'first' })
    process.env.ALEO_ACCOUNT = 'second'
    const state = await session.ensureKeyMaterial(session.loadState('testnet'))
    expect(state.account).toBe('first')
    // Save an explicitly selected account name in session state.
    expect((await session.ensureKeyMaterial(session.loadState('testnet'), { name: 'second' })).account).toBe('second')
  })
})

describe('account lookup', () => {
  it('selects the account by --name, then ALEO_ACCOUNT, then the recorded name, then default', async () => {
    const accounts: Record<string, { address: string; privateKey: string }> = {}
    for (const name of ['default', 'recorded', 'from-env', 'flag']) {
      accounts[name] = newAccount()
      await sandbox.keystore.saveAccount(accounts[name]!, { name })
    }
    const selected = async (state: { account?: string }, name?: string) =>
      (await lookup.resolveAccount({ state: { network: 'testnet', ...state }, name })).account.address

    expect(await selected({})).toBe(accounts.default!.address)
    expect(await selected({ account: 'recorded' })).toBe(accounts.recorded!.address)
    process.env.ALEO_ACCOUNT = 'from-env'
    expect(await selected({ account: 'recorded' })).toBe(accounts['from-env']!.address)
    expect(await selected({ account: 'recorded' }, 'flag')).toBe(accounts.flag!.address)
    // Ignore an empty ALEO_ACCOUNT when selecting the account name.
    process.env.ALEO_ACCOUNT = ''
    expect(await selected({ account: 'recorded' })).toBe(accounts.recorded!.address)
  })

  it('requires the key to derive the address the state records, naming both', async () => {
    const owner = newAccount()
    const other = newAccount()
    await sandbox.keystore.saveAccount(owner)
    const state = { network: 'testnet', address: other.address }
    const failure = lookup.resolveAccount({ state })
    await expect(failure).rejects.toMatchObject({ code: 'ADDRESS_MISMATCH' })
    await expect(failure).rejects.toThrow(owner.address)
    await expect(failure).rejects.toThrow(other.address)

    // Validate the expected address even after a successful cached lookup.
    await lookup.resolveAccount({ state: { network: 'testnet', address: owner.address } })
    expect(await codeOf(lookup.resolveAccount({ state }))).toBe('ADDRESS_MISMATCH')
    // Validate environment keys against the saved address.
    process.env.ALEO_PRIVATE_KEY = other.privateKey
    expect(await codeOf(lookup.resolveAccount({ state: { network: 'testnet', address: other.address } }))).toBe(
      'ADDRESS_MISMATCH',
    )
  })

  it.each(['environment', 'argument'] as const)(
    'checks a key from the %s against a key-only legacy state',
    async (source) => {
      const owner = newAccount()
      const other = newAccount()
      const state = { network: 'testnet', privateKey: owner.privateKey }
      const resolve = (privateKey: string) => {
        if (source === 'environment') process.env.ALEO_PRIVATE_KEY = privateKey
        return lookup.resolveAccount({ state, privateKey: source === 'argument' ? privateKey : undefined })
      }

      expect(await codeOf(resolve(other.privateKey))).toBe('ADDRESS_MISMATCH')
      expect((await resolve(owner.privateKey)).account.address).toBe(owner.address)
    },
  )

  it('checks a cached signer against the legacy key when the recorded address is omitted', async () => {
    const owner = newAccount()
    const other = newAccount()
    const state = { network: 'testnet', privateKey: owner.privateKey }
    process.env.ALEO_PRIVATE_KEY = other.privateKey

    // An explicit address takes precedence over the fallback key's address.
    const loaded = await lookup.resolveAccount({ state: { ...state, address: other.address } })
    expect(loaded.account.address).toBe(other.address)

    // Omitting that address must validate the legacy identity even after a successful lookup.
    expect(await codeOf(lookup.resolveAccount({ state }))).toBe('ADDRESS_MISMATCH')
  })

  it('prefers a key in the environment to the account file, and never stores it', async () => {
    const owner = newAccount()
    await sandbox.keystore.saveAccount(owner, { storage: 'none' })
    const state = { network: 'testnet', address: owner.address, account: 'default' }
    expect(await codeOf(lookup.resolveAccount({ state }))).toBe('KEY_NOT_STORED')

    const keyFile = join(sandbox.root, 'key.txt')
    writeFileSync(keyFile, `${owner.privateKey}\n`)
    process.env.ALEO_PRIVATE_KEY_FILE = keyFile
    const loaded = await lookup.resolveAccount({ state })
    expect(loaded.source).toBe('env-file')
    expect(loaded.account.address).toBe(owner.address)
    expect(onDisk(sandbox.dir, owner.privateKey)).toBe(false)

    // Reject an empty key variable before considering other sources.
    process.env.ALEO_PRIVATE_KEY = ''
    expect(await codeOf(lookup.resolveAccount({ state }))).toBe('EMPTY_KEY_SOURCE')
  })

  it('takes an explicit key first, without reading the key variables', async () => {
    const owner = newAccount()
    process.env.ALEO_PRIVATE_KEY = ''
    const loaded = await lookup.resolveAccount({ state: { network: 'testnet' }, privateKey: owner.privateKey })
    expect(loaded.source).toBe('argument')
    expect(loaded.account.address).toBe(owner.address)
    // Validate an explicitly supplied key against the saved address.
    expect(
      await codeOf(
        lookup.resolveAccount({ state: { network: 'testnet', address: newAccount().address }, privateKey: owner.privateKey }),
      ),
    ).toBe('ADDRESS_MISMATCH')
  })

  it('unlocks an encrypted account once per process', async () => {
    const owner = newAccount()
    await sandbox.keystore.saveAccount(owner, { storage: 'encrypted', password: PASSWORD })
    // Prompt when the mock Keychain has no saved password.
    sandbox.flags.terminal = true
    sandbox.answers.push(PASSWORD)
    const state = await session.ensureKeyMaterial(session.loadState('testnet'))
    expect(state).toMatchObject({ address: owner.address, account: 'default' })
    // Load the saved session to check that setup and session reuse the lookup.
    const loaded = await lookup.resolveAccount({ state: session.loadState('testnet') })
    expect(loaded.account.address).toBe(owner.address)
    expect(sandbox.prompts).toHaveLength(1)
  })
})

describe('loadSession', () => {
  it('needs setup to have run', async () => {
    process.env.ALEO_PRIVATE_KEY = newAccount().privateKey
    await expect(session.loadSession()).rejects.toThrow('No shield-swap session found for testnet')
  })

  it('builds the session from the account file, by the recorded name', async () => {
    const owner = newAccount()
    await sandbox.keystore.saveAccount(owner, { name: 'trading' })
    await sandbox.keystore.saveAccount(newAccount())
    session.saveState({ network: 'testnet', address: owner.address, account: 'trading' })
    const { account, state, network } = await session.loadSession()
    expect(account.address).toBe(owner.address)
    expect(network).toBe('testnet')
    expect(state.privateKey).toBeUndefined()
    expect(stderr()).toEqual([])
  })

  it('takes an explicit name over ALEO_ACCOUNT and the recorded name', async () => {
    const owner = newAccount()
    await sandbox.keystore.saveAccount(owner, { name: 'flag' })
    session.saveState({ network: 'mainnet', address: owner.address, account: 'recorded' })
    process.env.ALEO_ACCOUNT = 'from-env'
    expect(await codeOf(session.loadSession({ network: 'mainnet' }))).toBe('ACCOUNT_NOT_FOUND')
    expect((await session.loadSession({ network: 'mainnet', name: 'flag' })).account.address).toBe(owner.address)
  })

  it('keeps a state file that still holds its key working', async () => {
    const owner = newAccount()
    legacyState(owner)
    const { account } = await session.loadSession()
    expect(account.address).toBe(owner.address)
    expect(stderr().filter((line) => line.includes('shield-swap account migrate'))).toHaveLength(1)
    expect(readState().privateKey === owner.privateKey).toBe(true)
  })

  it('reports a recorded account whose key is not found', async () => {
    session.saveState({ network: 'testnet', address: newAccount().address, account: 'default' })
    expect(await codeOf(session.loadSession())).toBe('ACCOUNT_NOT_FOUND')
  })
})

describe('setup', () => {
  let setup: (argv: string[]) => Promise<void>
  let loadSession: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    // Stop setup before DEX authentication; this test covers account storage.
    loadSession = vi.fn(async () => {
      throw new Error('stopped before the network')
    })
    vi.doMock('../src/session.js', () => ({ ...session, loadSession }))
    ;({ main: setup } = await import('../src/commands/setup.js'))
  })

  it('stops with NEEDS_CONFIG_DECISION when there is no key and no --new', async () => {
    const outcome = await sandbox.run(setup, [])
    expect(outcome.status).toBe(2)
    expect(outcome.err).toContain('NEEDS_CONFIG_DECISION')
    expect(loadSession).not.toHaveBeenCalled()
    expect(existsSync(sandbox.dir)).toBe(false)
    expect(existsSync(statePath())).toBe(false)
  })

  it('generates and stores an account with --new', async () => {
    const outcome = await sandbox.run(setup, ['--new'])
    // Confirm setup reaches the mocked authentication step after saving the account.
    expect(outcome.status).toBe(1)
    expect(outcome.err).toContain('stopped before the network')
    expect(loadSession).toHaveBeenCalledWith({ network: 'testnet', name: undefined })
    const stored = await sandbox.keystore.accountInfo()
    expect(stored?.storage).toBe('plaintext')
    expect(readState()).toEqual({ network: 'testnet', address: stored!.address, account: 'default' })
    expect(outcome.out).toContain(stored!.address)
    expect(outcome.out.includes('APrivateKey1')).toBe(false)
  })

  it('stores the account under --name and passes the name on', async () => {
    process.env.ALEO_ACCOUNT = 'from-env'
    await sandbox.run(setup, ['--new', '--name', 'trading', '--network', 'mainnet'])
    expect(loadSession).toHaveBeenCalledWith({ network: 'mainnet', name: 'trading' })
    expect(readState('mainnet')).toMatchObject({ network: 'mainnet', account: 'trading' })
    expect((await sandbox.keystore.accountInfo({ name: 'trading' }))?.address).toBe(readState('mainnet').address)
    expect(await sandbox.keystore.accountInfo({ name: 'from-env' })).toBeUndefined()
  })

  it('imports the key of --private-key-file into the account file', async () => {
    const owner = newAccount()
    const keyFile = join(sandbox.root, 'key.txt')
    writeFileSync(keyFile, `${owner.privateKey}\n`)
    const outcome = await sandbox.run(setup, ['--private-key-file', keyFile])
    expect(loadSession).toHaveBeenCalledTimes(1)
    expect((await sandbox.keystore.exportAccount()) === owner.privateKey).toBe(true)
    expect(readState()).toEqual({ network: 'testnet', address: owner.address, account: 'default' })
    expect(onDisk(sandbox.stateRoot, owner.privateKey)).toBe(false)
    expect((outcome.out + outcome.err).includes(owner.privateKey)).toBe(false)
  })

  it('never copies a key from the environment to disk', async () => {
    const owner = newAccount()
    const keyFile = join(sandbox.root, 'key.txt')
    writeFileSync(keyFile, owner.privateKey)
    for (const [variable, value] of [
      ['ALEO_PRIVATE_KEY', owner.privateKey],
      ['SHIELD_SWAP_PRIVATE_KEY', owner.privateKey],
      ['SHIELD_SWAP_PRIVATE_KEY_FILE', keyFile],
    ] as const) {
      process.env[variable] = value
      await sandbox.run(setup, ['--new'])
      delete process.env[variable]
      expect(loadSession).toHaveBeenCalled()
      expect(readState()).toEqual({ network: 'testnet', address: owner.address })
      expect(existsSync(sandbox.dir)).toBe(false)
      expect(onDisk(sandbox.stateRoot, owner.privateKey)).toBe(false)
    }
  })

  it('exits 2 when the account needs a password and nobody is there to give it', async () => {
    await sandbox.keystore.saveAccount(newAccount(), { storage: 'encrypted', password: PASSWORD })
    const outcome = await sandbox.run(setup, [])
    expect(outcome.status).toBe(2)
    expect(outcome.err).toContain('PASSWORD_REQUIRED: ')
    expect(loadSession).not.toHaveBeenCalled()
    expect(statSync(sandbox.dir).isDirectory()).toBe(true)
    expect(existsSync(statePath())).toBe(false)
  })
})
