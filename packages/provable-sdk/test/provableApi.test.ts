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

/** Seconds-since-epoch `exp` an hour out, matching the API's claim units. */
const futureExp = () => Math.floor(Date.now() / 1000) + 3600

/** Builds a fetch stub that records calls and answers registration and mint requests. */
function stubFetch(
  overrides: {
    register?: () => Response
    mint?: () => Response
  } = {},
) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url.toString()
    calls.push(`${init?.method ?? 'GET'} ${href}`)
    if (href.endsWith('/consumers')) {
      return (
        overrides.register?.() ??
        new Response(JSON.stringify({ consumer: { id: 'consumer-new' }, key: 'key-new' }), {
          status: 200,
        })
      )
    }
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
    it('returns the consumer id and key from a successful registration', async () => {
      stubFetch()
      const credentials = await registerProvableApi({ username: 'bot' })
      expect(credentials).toEqual({ consumerId: 'consumer-new', apiKey: 'key-new' })
    })

    it('posts the username to the API root, not a versioned path', async () => {
      const { calls } = stubFetch()
      await registerProvableApi({ username: 'bot', baseUrl: 'https://example.test' })
      expect(calls).toEqual(['POST https://example.test/consumers'])
    })

    it('surfaces the status and body when registration fails', async () => {
      stubFetch({ register: () => new Response('username taken', { status: 409 }) })
      await expect(registerProvableApi({ username: 'taken' })).rejects.toThrow(
        /HTTP 409.*username taken/,
      )
    })

    it('explains that a taken username cannot be traded for its credentials', async () => {
      stubFetch({
        register: () =>
          new Response(JSON.stringify({ message: "UNIQUE violation detected on '{username=\"taken\"}'" }), {
            status: 409,
          }),
      })
      // The obvious next moves — look the consumer up, or re-register to get the
      // key again — do not exist, so the error has to say so.
      await expect(registerProvableApi({ username: 'taken' })).rejects.toThrow(
        /username 'taken' is already registered.*cannot be recovered.*different name/s,
      )
    })

    it('rejects a 2xx response that omits the credentials', async () => {
      stubFetch({ register: () => new Response(JSON.stringify({ consumer: {} }), { status: 200 }) })
      await expect(registerProvableApi({ username: 'bot' })).rejects.toThrow(/no consumer id and key/)
    })
  })

  describe('createProvableSession', () => {
    it('reads the token from the authorization header and the expiry from exp, in ms', async () => {
      const exp = futureExp()
      stubFetch({
        mint: () =>
          new Response(JSON.stringify({ exp }), {
            status: 200,
            headers: { authorization: 'Bearer abc' },
          }),
      })
      const session = createProvableSession({ credentials: CREDENTIALS })
      expect(await session.getJwt()).toEqual({ jwt: 'Bearer abc', expiration: exp * 1000 })
    })

    it('caches a valid token instead of minting again', async () => {
      const { fetchMock } = stubFetch()
      const session = createProvableSession({ credentials: CREDENTIALS })
      await session.getJwt()
      await session.getJwt()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('re-mints when forceRefresh is set', async () => {
      const { fetchMock } = stubFetch()
      const session = createProvableSession({ credentials: CREDENTIALS })
      await session.getJwt()
      await session.getJwt({ forceRefresh: true })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('treats a token inside the five-minute margin as stale', async () => {
      // Expires in four minutes — inside the margin, so the cache must not serve it.
      const { fetchMock } = stubFetch({
        mint: () =>
          new Response(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 240 }), {
            status: 200,
            headers: { authorization: 'Bearer soon' },
          }),
      })
      const session = createProvableSession({ credentials: CREDENTIALS })
      await session.getJwt()
      await session.getJwt()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('collapses concurrent mints onto one request', async () => {
      const { fetchMock } = stubFetch()
      const session = createProvableSession({ credentials: CREDENTIALS })
      const [a, b, c] = await Promise.all([session.getJwt(), session.getJwt(), session.getJwt()])
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(a).toEqual(b)
      expect(b).toEqual(c)
    })

    it('prefers supplied credentials over a store, so an operator can inject a rotated key', async () => {
      const { calls } = stubFetch()
      const store: ProvableCredentialStore = {
        load: () => ({ consumerId: 'stored', apiKey: 'stored-key' }),
        save: () => {},
      }
      const session = createProvableSession({ credentials: CREDENTIALS, store })
      await session.getJwt()
      expect(calls[0]).toContain('/jwts/consumer-1')
    })

    it('loads credentials from the store without registering', async () => {
      const { calls } = stubFetch()
      const save = vi.fn()
      const store: ProvableCredentialStore = {
        load: () => ({ consumerId: 'stored', apiKey: 'stored-key' }),
        save,
      }
      const session = createProvableSession({ store, username: 'bot' })
      expect(await session.getCredentials()).toEqual({ consumerId: 'stored', apiKey: 'stored-key' })
      expect(session.registeredConsumer()).toBe(false)
      expect(save).not.toHaveBeenCalled()
      expect(calls.some((c) => c.includes('/consumers'))).toBe(false)
    })

    it('registers and saves when the store is empty, reporting the registration', async () => {
      stubFetch()
      const saved: ProvableApiCredentials[] = []
      const store: ProvableCredentialStore = {
        load: () => undefined,
        save: (c) => void saved.push(c),
      }
      const session = createProvableSession({ store, username: 'bot' })
      const credentials = await session.getCredentials()
      expect(credentials).toEqual({ consumerId: 'consumer-new', apiKey: 'key-new' })
      expect(saved).toEqual([credentials])
      expect(session.registeredConsumer()).toBe(true)
    })

    it('holds registered credentials even when persisting them fails', async () => {
      stubFetch()
      const store: ProvableCredentialStore = {
        load: () => undefined,
        save: () => {
          throw new Error('disk full')
        },
      }
      const session = createProvableSession({ store, username: 'bot' })

      // Loud, because the key cannot be reissued and is now unstored.
      await expect(session.getCredentials()).rejects.toThrow(
        /Registered Provable API consumer consumer-new, but persisting.*failed/s,
      )
      // But held, so the process can still read and store them by hand.
      expect(await session.getCredentials()).toEqual({ consumerId: 'consumer-new', apiKey: 'key-new' })
    })

    it('does not register a second consumer after a failed save', async () => {
      const { calls } = stubFetch()
      const store: ProvableCredentialStore = {
        load: () => undefined,
        save: () => {
          throw new Error('disk full')
        },
      }
      const session = createProvableSession({ store, username: 'bot' })

      await expect(session.getCredentials()).rejects.toThrow(/persisting/)
      await session.getCredentials().catch(() => {})
      await session.getJwt().catch(() => {})
      // A username is spent once, so retrying must not burn another name.
      expect(calls.filter((c) => c.includes('/consumers'))).toHaveLength(1)
    })

    it('does not resolve the username function when an override is given', async () => {
      stubFetch()
      const username = vi.fn(() => 'derived-name')
      const session = createProvableSession({ username })
      await session.getCredentials({ username: 'explicit-name' })
      expect(username).not.toHaveBeenCalled()
    })

    it('registers once when several callers resolve credentials concurrently', async () => {
      const { calls } = stubFetch()
      const session = createProvableSession({ username: 'bot' })
      await Promise.all([session.getCredentials(), session.getCredentials(), session.getJwt()])
      expect(calls.filter((c) => c.includes('/consumers'))).toHaveLength(1)
    })

    it('throws when registration is needed and no username is configured', async () => {
      stubFetch()
      const session = createProvableSession({})
      await expect(session.getCredentials()).rejects.toThrow(/no Provable API credentials/i)
    })

    it('calls a username function lazily, so it can read state set after construction', async () => {
      stubFetch()
      let address = ''
      const session = createProvableSession({ username: () => `veil-${address}` })
      address = 'aleo1abc'
      await session.getCredentials()
      expect(session.registeredConsumer()).toBe(true)
    })

    it('records the consumers it has been attached to', () => {
      const session = createProvableSession({ credentials: CREDENTIALS })
      expect(session.consumers).toEqual({ proving: false, recordScanning: false })
      session.attach('proving')
      expect(session.consumers).toEqual({ proving: true, recordScanning: false })
    })
  })

  describe('authenticateProvableApi', () => {
    it('resolves the session and reports the credentials, expiry, and wiring', async () => {
      const exp = futureExp()
      stubFetch({
        mint: () =>
          new Response(JSON.stringify({ exp }), {
            status: 200,
            headers: { authorization: 'Bearer abc' },
          }),
      })
      const session = createProvableSession({ credentials: CREDENTIALS })
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

    it('reports recordScanning false when only proving carries the session', async () => {
      stubFetch()
      const session = createProvableSession({ credentials: CREDENTIALS })
      session.attach('proving')
      const result = await authenticateProvableApi(clientWithSession(session))
      expect(result.applied).toEqual({ proving: true, recordScanning: false })
    })

    it('reports a registration so the caller knows to persist the key', async () => {
      stubFetch()
      const session = createProvableSession({ username: 'bot' })
      const result = await authenticateProvableApi(clientWithSession(session))
      expect(result.registered).toBe(true)
      expect(result.credentials).toEqual({ consumerId: 'consumer-new', apiKey: 'key-new' })
    })

    it('throws with a setup hint when the client carries no session', async () => {
      const client = { proving: { mode: 'delegated' } } as unknown as Client
      await expect(authenticateProvableApi(client)).rejects.toThrow(
        /No Provable API session on this client/,
      )
    })

    it('throws when the client has no proving configuration at all', async () => {
      await expect(authenticateProvableApi({} as Client)).rejects.toThrow(
        /No Provable API session on this client/,
      )
    })

    it('forwards forceRefresh to the session', async () => {
      const { fetchMock } = stubFetch()
      const session = createProvableSession({ credentials: CREDENTIALS })
      const client = clientWithSession(session)
      await authenticateProvableApi(client)
      await authenticateProvableApi(client, { forceRefresh: true })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('memoryCredentialStore', () => {
    it('starts empty, so a session registers into it', async () => {
      stubFetch()
      const store = memoryCredentialStore()
      expect(await store.load()).toBeUndefined()

      const session = createProvableSession({ store, username: 'bot' })
      const credentials = await session.getCredentials()
      expect(session.registeredConsumer()).toBe(true)
      // Written through, so a second session over the same store reuses it.
      expect(await store.load()).toEqual(credentials)
    })

    it('reuses credentials across sessions sharing the store', async () => {
      const { calls } = stubFetch()
      const store = memoryCredentialStore()
      await createProvableSession({ store, username: 'bot' }).getCredentials()
      const second = createProvableSession({ store, username: 'bot' })
      await second.getCredentials()
      expect(second.registeredConsumer()).toBe(false)
      expect(calls.filter((c) => c.includes('/consumers'))).toHaveLength(1)
    })

    it('skips registration entirely when seeded', async () => {
      const { calls } = stubFetch()
      const session = createProvableSession({ store: memoryCredentialStore(CREDENTIALS) })
      expect(await session.getCredentials()).toEqual(CREDENTIALS)
      expect(calls.some((c) => c.includes('/consumers'))).toBe(false)
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

    it('reads a missing file as not-yet-registered', async () => {
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

    it('writes owner-only, since the key cannot be reissued', async () => {
      const path = join(dir, 'creds.json')
      await fileCredentialStore(path).save(CREDENTIALS)
      expect((await stat(path)).mode & 0o777).toBe(0o600)
    })

    it('reports an unreadable file rather than registering a replacement', async () => {
      const path = join(dir, 'creds.json')
      await writeFile(path, JSON.stringify(CREDENTIALS), { mode: 0o600 })
      await chmod(path, 0o000)
      try {
        // Treating EACCES as "absent" would register a new consumer and abandon
        // the key in this file, which the API cannot reissue.
        await expect(fileCredentialStore(path).load()).rejects.toThrow(
          /could not be read \(EACCES\).*Refusing to register a replacement/s,
        )
      } finally {
        await chmod(path, 0o600)
      }
    })

    it('reads a path whose parent is not a directory as absent', async () => {
      const file = join(dir, 'not-a-dir')
      await writeFile(file, 'x')
      // ENOTDIR, like ENOENT, means there is genuinely nothing stored there.
      expect(await fileCredentialStore(join(file, 'creds.json')).load()).toBeUndefined()
    })

    it('reports malformed JSON rather than silently re-registering over it', async () => {
      const path = join(dir, 'creds.json')
      await writeFile(path, '{ not json')
      await expect(fileCredentialStore(path).load()).rejects.toThrow(/not valid JSON/)
    })

    it('reports a file missing either half of the pair', async () => {
      const path = join(dir, 'creds.json')
      await writeFile(path, JSON.stringify({ consumerId: 'only-half' }))
      await expect(fileCredentialStore(path).load()).rejects.toThrow(/missing consumerId or apiKey/)
    })

    it('registers on the first session and reuses the file on the next', async () => {
      const { calls } = stubFetch()
      const path = join(dir, 'creds.json')

      const first = createProvableSession({ store: fileCredentialStore(path), username: 'bot' })
      const credentials = await first.getCredentials()
      expect(first.registeredConsumer()).toBe(true)

      const second = createProvableSession({ store: fileCredentialStore(path), username: 'bot' })
      expect(await second.getCredentials()).toEqual(credentials)
      expect(second.registeredConsumer()).toBe(false)
      expect(calls.filter((c) => c.includes('/consumers'))).toHaveLength(1)
    })
  })

  describe('provableApiActions', () => {
    it('binds the action to the client it decorates', async () => {
      stubFetch()
      const session = createProvableSession({ credentials: CREDENTIALS })
      const client = clientWithSession(session)
      const actions = provableApiActions()(client)
      const result = await actions.authenticateProvableApi()
      expect(result.credentials).toEqual(CREDENTIALS)
    })
  })
})
