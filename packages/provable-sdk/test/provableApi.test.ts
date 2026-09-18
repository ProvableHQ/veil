import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  registerProvableApi,
  createProvableSession,
  memoryCredentialStore,
  authenticateProvableApi,
  provableApiActions,
  type ProvableApiCredentials,
  type ProvableCredentialStore,
} from '../src/provableApi.js'
import { fileCredentialStore } from '../src/node.js'
import type { Client } from '@provablehq/veil-core'

const CREDENTIALS: ProvableApiCredentials = { consumerId: 'consumer-1', apiKey: 'key-1' }

/** Fails the test on any network call: the gateway needs none of them. */
function forbidFetch() {
  const fetchMock = vi.fn(async (url: string | URL) => {
    throw new Error(`unexpected request: ${url.toString()}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** A minimal client whose proving configuration carries a session. */
function clientWithSession(session: unknown): Client {
  return { proving: { mode: 'delegated', session } } as unknown as Client
}

describe('provableApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('registerProvableApi', () => {
    it('resolves to undefined without contacting the network', async () => {
      const fetchMock = forbidFetch()
      await expect(registerProvableApi({ username: 'bot' })).resolves.toBeUndefined()
      await expect(
        registerProvableApi({ username: 'bot', baseUrl: 'https://example.test' }),
      ).resolves.toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('createProvableSession', () => {
    it('mints nothing: getJwt resolves to undefined and fetch is never called', async () => {
      const fetchMock = forbidFetch()
      const session = createProvableSession({ credentials: CREDENTIALS })
      await expect(session.getJwt()).resolves.toBeUndefined()
      await expect(session.getJwt({ forceRefresh: true })).resolves.toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reports supplied credentials verbatim', async () => {
      forbidFetch()
      const session = createProvableSession({ credentials: CREDENTIALS })
      await expect(session.getCredentials()).resolves.toEqual(CREDENTIALS)
      expect(session.registeredConsumer()).toBe(false)
    })

    it('prefers supplied credentials over a store', async () => {
      forbidFetch()
      const store: ProvableCredentialStore = {
        load: () => ({ consumerId: 'stored', apiKey: 'stored-key' }),
        save: () => {},
      }
      const session = createProvableSession({ credentials: CREDENTIALS, store })
      await expect(session.getCredentials()).resolves.toEqual(CREDENTIALS)
    })

    it('reads credentials from the store without writing to it', async () => {
      forbidFetch()
      const save = vi.fn()
      const store: ProvableCredentialStore = {
        load: () => ({ consumerId: 'stored', apiKey: 'stored-key' }),
        save,
      }
      const session = createProvableSession({ store, username: 'bot' })
      await expect(session.getCredentials()).resolves.toEqual({ consumerId: 'stored', apiKey: 'stored-key' })
      expect(session.registeredConsumer()).toBe(false)
      expect(save).not.toHaveBeenCalled()
    })

    it('reports no credentials when the store is empty, instead of registering', async () => {
      const fetchMock = forbidFetch()
      const save = vi.fn()
      const store: ProvableCredentialStore = { load: () => undefined, save }
      const session = createProvableSession({ store, username: 'bot' })
      await expect(session.getCredentials()).resolves.toBeUndefined()
      expect(session.registeredConsumer()).toBe(false)
      expect(save).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('never resolves the username function, since nothing registers', async () => {
      forbidFetch()
      const username = vi.fn(() => 'derived-name')
      const session = createProvableSession({ username })
      await expect(session.getCredentials({ username: 'explicit-name' })).resolves.toBeUndefined()
      await expect(session.getCredentials()).resolves.toBeUndefined()
      expect(username).not.toHaveBeenCalled()
    })

    it('records the consumers it has been attached to', () => {
      const session = createProvableSession({ credentials: CREDENTIALS })
      expect(session.consumers).toEqual({ proving: false, recordScanning: false })
      session.attach('proving')
      expect(session.consumers).toEqual({ proving: true, recordScanning: false })
    })
  })

  describe('authenticateProvableApi', () => {
    it('reports the configured credentials and wiring without any network call', async () => {
      const fetchMock = forbidFetch()
      const session = createProvableSession({ credentials: CREDENTIALS })
      session.attach('proving')
      session.attach('recordScanning')

      const result = await authenticateProvableApi(clientWithSession(session))
      expect(result).toEqual({
        credentials: CREDENTIALS,
        expiration: undefined,
        registered: false,
        applied: { proving: true, recordScanning: true },
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reports recordScanning false when only proving carries the session', async () => {
      forbidFetch()
      const session = createProvableSession({ credentials: CREDENTIALS })
      session.attach('proving')
      const result = await authenticateProvableApi(clientWithSession(session))
      expect(result.applied).toEqual({ proving: true, recordScanning: false })
    })

    it('is a no-op on a client that carries no session', async () => {
      forbidFetch()
      const client = { proving: { mode: 'delegated' } } as unknown as Client
      await expect(authenticateProvableApi(client)).resolves.toEqual({
        credentials: undefined,
        expiration: undefined,
        registered: false,
        applied: { proving: false, recordScanning: false },
      })
    })

    it('is a no-op on a client with no proving configuration at all', async () => {
      forbidFetch()
      await expect(authenticateProvableApi({} as Client)).resolves.toMatchObject({
        credentials: undefined,
        registered: false,
      })
    })

    it('ignores forceRefresh and username', async () => {
      const fetchMock = forbidFetch()
      const session = createProvableSession({ credentials: CREDENTIALS })
      const client = clientWithSession(session)
      await authenticateProvableApi(client, { forceRefresh: true, username: 'ignored' })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('memoryCredentialStore', () => {
    it('starts empty and stays empty, since nothing registers into it', async () => {
      forbidFetch()
      const store = memoryCredentialStore()
      expect(await store.load()).toBeUndefined()
      await createProvableSession({ store, username: 'bot' }).getCredentials()
      expect(await store.load()).toBeUndefined()
    })

    it('reports seeded credentials', async () => {
      forbidFetch()
      const session = createProvableSession({ store: memoryCredentialStore(CREDENTIALS) })
      await expect(session.getCredentials()).resolves.toEqual(CREDENTIALS)
    })
  })

  describe('fileCredentialStore', () => {
    let dir: string

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'veil-creds-'))
    })
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true })
    })

    it('reads a missing file as no credentials', async () => {
      const store = fileCredentialStore(join(dir, 'creds.json'))
      expect(await store.load()).toBeUndefined()
    })

    it('round-trips credentials through the file', async () => {
      const store = fileCredentialStore(join(dir, 'creds.json'))
      await store.save(CREDENTIALS)
      expect(await store.load()).toEqual(CREDENTIALS)
    })

    it('creates parent directories on save', async () => {
      const store = fileCredentialStore(join(dir, 'nested', 'deeper', 'creds.json'))
      await store.save(CREDENTIALS)
      expect(await store.load()).toEqual(CREDENTIALS)
    })

    it('writes owner-only', async () => {
      const path = join(dir, 'creds.json')
      await fileCredentialStore(path).save(CREDENTIALS)
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    })

    it('reports an unreadable file rather than treating it as absent', async () => {
      const path = join(dir, 'creds.json')
      await writeFile(path, JSON.stringify(CREDENTIALS), { mode: 0o600 })
      await chmod(path, 0o000)
      try {
        await expect(fileCredentialStore(path).load()).rejects.toThrow(/could not be read \(EACCES\)/)
      } finally {
        await chmod(path, 0o600)
      }
    })

    it('reports a path whose parent is not a directory rather than reading it as absent', async () => {
      const file = join(dir, 'not-a-dir')
      await writeFile(file, 'x')
      await expect(fileCredentialStore(join(file, 'creds.json')).load()).rejects.toThrow(
        /could not be read \(ENOTDIR\)/,
      )
    })

    it('reports malformed JSON', async () => {
      const path = join(dir, 'creds.json')
      await writeFile(path, '{ not json')
      await expect(fileCredentialStore(path).load()).rejects.toThrow(/not valid JSON/)
    })

    it('reports a file missing either half of the pair', async () => {
      const path = join(dir, 'creds.json')
      await writeFile(path, JSON.stringify({ consumerId: 'only-half' }))
      await expect(fileCredentialStore(path).load()).rejects.toThrow(/missing consumerId or apiKey/)
    })

    it('feeds stored credentials to a session without any network call', async () => {
      const fetchMock = forbidFetch()
      const path = join(dir, 'creds.json')
      await fileCredentialStore(path).save(CREDENTIALS)
      const session = createProvableSession({ store: fileCredentialStore(path) })
      await expect(session.getCredentials()).resolves.toEqual(CREDENTIALS)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('provableApiActions', () => {
    it('binds the action to the client it decorates', async () => {
      forbidFetch()
      const session = createProvableSession({ credentials: CREDENTIALS })
      const client = clientWithSession(session)
      const actions = provableApiActions()(client)
      const result = await actions.authenticateProvableApi()
      expect(result.credentials).toEqual(CREDENTIALS)
    })
  })
})
