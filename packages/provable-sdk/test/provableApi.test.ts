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
const LEGACY = 'https://api.provable.com'

/** Seconds-since-epoch `exp` an hour out, matching the API's claim units. */
const futureExp = () => Math.floor(Date.now() / 1000) + 3600

/** Builds a fetch stub that records calls and answers mint requests; anything else throws. */
function stubFetch(overrides: { mint?: () => Response } = {}) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString()
    calls.push(`${init?.method ?? 'GET'} ${href}`)
    if (href.includes('/jwts/')) {
      return (
        overrides.mint?.() ??
        new Response(JSON.stringify({ exp: futureExp() }), {
          status: 200,
          headers: { authorization: 'Bearer minted-jwt' },
        })
      )
    }
    throw new Error(`unexpected request: ${href}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock }
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
      const { fetchMock } = stubFetch()
      await expect(registerProvableApi({ username: 'bot' })).resolves.toBeUndefined()
      await expect(registerProvableApi({ username: 'bot', baseUrl: LEGACY })).resolves.toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('createProvableSession on a legacy gateway', () => {
    it('mints at the given root with the key in X-Provable-API-Key', async () => {
      const exp = futureExp()
      const { fetchMock } = stubFetch({
        mint: () =>
          new Response(JSON.stringify({ exp }), { status: 200, headers: { authorization: 'Bearer abc' } }),
      })
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: LEGACY })
      expect(await session.getJwt()).toEqual({ jwt: 'Bearer abc', expiration: exp * 1000 })
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe(`${LEGACY}/jwts/consumer-1`)
      expect((init as RequestInit).headers).toEqual({ 'X-Provable-API-Key': 'key-1' })
    })

    it('caches a valid token instead of minting again', async () => {
      const { fetchMock } = stubFetch()
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: LEGACY })
      await session.getJwt()
      await session.getJwt()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('re-mints when forceRefresh is set', async () => {
      const { fetchMock } = stubFetch()
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: LEGACY })
      await session.getJwt()
      await session.getJwt({ forceRefresh: true })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('treats a token inside the five-minute margin as stale', async () => {
      const { fetchMock } = stubFetch({
        mint: () =>
          new Response(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 240 }), {
            status: 200,
            headers: { authorization: 'Bearer soon' },
          }),
      })
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: LEGACY })
      await session.getJwt()
      await session.getJwt()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('collapses concurrent mints onto one request', async () => {
      const { fetchMock } = stubFetch()
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: LEGACY })
      const [a, b, c] = await Promise.all([session.getJwt(), session.getJwt(), session.getJwt()])
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(a).toEqual(b)
      expect(b).toEqual(c)
    })

    it('goes inert when the root has no JWT route, and does not ask again', async () => {
      const { fetchMock } = stubFetch({ mint: () => new Response('not found', { status: 404 }) })
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: 'https://devnode.example' })
      await expect(session.getJwt()).resolves.toBeUndefined()
      await expect(session.getJwt({ forceRefresh: true })).resolves.toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('surfaces the status when the gateway rejects the key', async () => {
      stubFetch({ mint: () => new Response('bad key', { status: 401 }) })
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: LEGACY })
      await expect(session.getJwt()).rejects.toThrow(/HTTP 401.*bad key/)
    })

    it('prefers supplied credentials over a store', async () => {
      const { calls } = stubFetch()
      const store: ProvableCredentialStore = {
        load: () => ({ consumerId: 'stored', apiKey: 'stored-key' }),
        save: () => {},
      }
      const session = createProvableSession({ credentials: CREDENTIALS, store, baseUrl: LEGACY })
      await session.getJwt()
      expect(calls[0]).toContain('/jwts/consumer-1')
    })

    it('mints from stored credentials without writing to the store', async () => {
      const { calls } = stubFetch()
      const save = vi.fn()
      const store: ProvableCredentialStore = {
        load: () => ({ consumerId: 'stored', apiKey: 'stored-key' }),
        save,
      }
      const session = createProvableSession({ store, username: 'bot', baseUrl: LEGACY })
      await expect(session.getCredentials()).resolves.toEqual({ consumerId: 'stored', apiKey: 'stored-key' })
      await session.getJwt()
      expect(calls).toEqual([`POST ${LEGACY}/jwts/stored`])
      expect(save).not.toHaveBeenCalled()
      expect(session.registeredConsumer()).toBe(false)
    })

    it('mints nothing and registers nothing when the store is empty', async () => {
      const { fetchMock } = stubFetch()
      const save = vi.fn()
      const store: ProvableCredentialStore = { load: () => undefined, save }
      const session = createProvableSession({ store, username: 'bot', baseUrl: LEGACY })
      await expect(session.getCredentials()).resolves.toBeUndefined()
      await expect(session.getJwt()).resolves.toBeUndefined()
      expect(save).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('never resolves the username function, since nothing registers', async () => {
      stubFetch()
      const username = vi.fn(() => 'derived-name')
      const session = createProvableSession({ username, baseUrl: LEGACY })
      await expect(session.getCredentials({ username: 'explicit-name' })).resolves.toBeUndefined()
      expect(username).not.toHaveBeenCalled()
    })
  })

  describe('createProvableSession without a legacy gateway', () => {
    it('is inert: reports the pair but mints nothing', async () => {
      const { fetchMock } = stubFetch()
      const session = createProvableSession({ credentials: CREDENTIALS })
      await expect(session.getCredentials()).resolves.toEqual(CREDENTIALS)
      await expect(session.getJwt()).resolves.toBeUndefined()
      await expect(session.getJwt({ forceRefresh: true })).resolves.toBeUndefined()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(session.registeredConsumer()).toBe(false)
    })

    it('records the consumers it has been attached to', () => {
      const session = createProvableSession({ credentials: CREDENTIALS })
      expect(session.consumers).toEqual({ proving: false, recordScanning: false })
      session.attach('proving')
      expect(session.consumers).toEqual({ proving: true, recordScanning: false })
    })
  })

  describe('authenticateProvableApi', () => {
    it('mints eagerly on a legacy gateway and reports the credentials, expiry, and wiring', async () => {
      const exp = futureExp()
      stubFetch({
        mint: () =>
          new Response(JSON.stringify({ exp }), { status: 200, headers: { authorization: 'Bearer abc' } }),
      })
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: LEGACY })
      session.attach('proving')
      session.attach('recordScanning')

      const result = await authenticateProvableApi(clientWithSession(session))
      expect(result).toEqual({
        credentials: CREDENTIALS,
        expiration: exp * 1000,
        registered: false,
        applied: { proving: true, recordScanning: true },
      })
    })

    it('reports the pair with no expiry on the default gateway', async () => {
      const { fetchMock } = stubFetch()
      const session = createProvableSession({ credentials: CREDENTIALS })
      session.attach('proving')
      const result = await authenticateProvableApi(clientWithSession(session))
      expect(result).toEqual({
        credentials: CREDENTIALS,
        expiration: undefined,
        registered: false,
        applied: { proving: true, recordScanning: false },
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('is a no-op on a client that carries no session', async () => {
      const { fetchMock } = stubFetch()
      const client = { proving: { mode: 'delegated' } } as unknown as Client
      await expect(authenticateProvableApi(client)).resolves.toEqual({
        credentials: undefined,
        expiration: undefined,
        registered: false,
        applied: { proving: false, recordScanning: false },
      })
      await expect(authenticateProvableApi({} as Client)).resolves.toMatchObject({ credentials: undefined })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('forwards forceRefresh to the session', async () => {
      const { fetchMock } = stubFetch()
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: LEGACY })
      const client = clientWithSession(session)
      await authenticateProvableApi(client)
      await authenticateProvableApi(client, { forceRefresh: true })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('surfaces a rejected key before any transaction is built', async () => {
      stubFetch({ mint: () => new Response('revoked', { status: 401 }) })
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: LEGACY })
      await expect(authenticateProvableApi(clientWithSession(session))).rejects.toThrow(/HTTP 401/)
    })
  })

  describe('memoryCredentialStore', () => {
    it('starts empty and stays empty, since nothing registers into it', async () => {
      stubFetch()
      const store = memoryCredentialStore()
      expect(await store.load()).toBeUndefined()
      await createProvableSession({ store, username: 'bot', baseUrl: LEGACY }).getCredentials()
      expect(await store.load()).toBeUndefined()
    })

    it('feeds seeded credentials to a session', async () => {
      const { calls } = stubFetch()
      const session = createProvableSession({ store: memoryCredentialStore(CREDENTIALS), baseUrl: LEGACY })
      await expect(session.getCredentials()).resolves.toEqual(CREDENTIALS)
      await session.getJwt()
      expect(calls).toEqual([`POST ${LEGACY}/jwts/consumer-1`])
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

    it('feeds stored credentials to a session that mints on a legacy gateway', async () => {
      const { calls } = stubFetch()
      const path = join(dir, 'creds.json')
      await fileCredentialStore(path).save(CREDENTIALS)
      const session = createProvableSession({ store: fileCredentialStore(path), baseUrl: LEGACY })
      await session.getJwt()
      expect(calls).toEqual([`POST ${LEGACY}/jwts/consumer-1`])
    })
  })

  describe('provableApiActions', () => {
    it('binds the action to the client it decorates', async () => {
      stubFetch()
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: LEGACY })
      const client = clientWithSession(session)
      const actions = provableApiActions()(client)
      const result = await actions.authenticateProvableApi()
      expect(result.credentials).toEqual(CREDENTIALS)
      expect(result.expiration).toBeGreaterThan(Date.now())
    })
  })
})
