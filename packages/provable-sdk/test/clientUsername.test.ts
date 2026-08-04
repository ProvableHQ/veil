import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest'
import { loadNetwork, memoryCredentialStore, createProvableSession, type AleoSdk } from '../src/index.js'

/**
 * The name a client registers a Provable API consumer under.
 *
 * A username is spent once — the API exposes no way to read a consumer back and
 * a duplicate registration returns nothing usable — so which name is used, and
 * whether a caller can choose it, is not a cosmetic detail. Registration is
 * stubbed here: hitting the real API would create consumers that cannot be
 * deleted.
 */
describe('createAleoClient username', () => {
  let aleo: AleoSdk

  beforeAll(async () => {
    // Loaded before the fetch stub goes up, so WASM fetching is unaffected.
    aleo = await loadNetwork('testnet')
  }, 60_000)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Captures the username each registration is attempted with. */
  function stubRegistration() {
    const usernames: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const href = url.toString()
        if (href.endsWith('/consumers')) {
          usernames.push(JSON.parse(String(init?.body)).username)
          return new Response(JSON.stringify({ consumer: { id: 'c-1' }, key: 'k-1' }), { status: 201 })
        }
        if (href.includes('/jwts/')) {
          return new Response(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }), {
            status: 201,
            headers: { authorization: 'Bearer stub' },
          })
        }
        throw new Error(`unexpected request: ${href}`)
      }),
    )
    return usernames
  }

  const client = (username?: string | (() => string)) =>
    aleo.createAleoClient({
      privateKey: aleo.generateAccount().privateKey,
      networkUrl: 'https://api.provable.com/v2',
      proverUrl: 'https://api.provable.com/prove',
      credentialStore: memoryCredentialStore(),
      ...(username !== undefined ? { username } : {}),
    }).walletClient

  it('registers under a caller-supplied name verbatim', async () => {
    const usernames = stubRegistration()
    await client('my-bot-42').authenticateProvableApi()
    // Verbatim matters: a silently suffixed name defeats the point of choosing one.
    expect(usernames).toEqual(['my-bot-42'])
  }, 30_000)

  it('calls a supplied function lazily, at registration time', async () => {
    const usernames = stubRegistration()
    let shard = 'unset'
    const wallet = client(() => `bot-${shard}`)
    shard = 'eu-1'
    await wallet.authenticateProvableApi()
    expect(usernames).toEqual(['bot-eu-1'])
  }, 30_000)

  it('derives a name from the account address when none is given', async () => {
    const usernames = stubRegistration()
    await client().authenticateProvableApi()
    expect(usernames).toHaveLength(1)
    expect(usernames[0]).toMatch(/^veil-[a-z0-9]{8}-[a-z0-9]{1,6}$/)
  }, 30_000)

  it('varies the derived name per client, so a lost key can be re-registered', async () => {
    const usernames = stubRegistration()
    await client().authenticateProvableApi()
    await client().authenticateProvableApi()
    expect(usernames[0]).not.toBe(usernames[1])
  }, 30_000)

  it('does not register at all when credentials are already configured', async () => {
    const usernames = stubRegistration()
    const wallet = aleo.createAleoClient({
      privateKey: aleo.generateAccount().privateKey,
      networkUrl: 'https://api.provable.com/v2',
      proverUrl: 'https://api.provable.com/prove',
      consumerId: 'existing-consumer',
      apiKey: 'existing-key',
      username: 'would-be-ignored',
    }).walletClient

    const result = await wallet.authenticateProvableApi()
    expect(usernames).toEqual([])
    expect(result.registered).toBe(false)
    expect(result.credentials).toEqual({ consumerId: 'existing-consumer', apiKey: 'existing-key' })
  }, 30_000)

  describe('scanner credential validation', () => {
    it('rejects an apiKey without a consumerId on a remote scanner', () => {
      // Half a pair authenticates nothing: the id is the path segment and the
      // key the header, so this would 401 four times instead of failing here.
      expect(() =>
        aleo.createRemoteScanner({ url: 'https://api.provable.com/scanner', apiKey: 'k' }),
      ).toThrow(/apiKey also needs consumerId/)
    })

    it('rejects an apiKey without a consumerId on a standalone scanner', () => {
      expect(() =>
        aleo.createStandaloneScanner({
          url: 'https://api.provable.com/scanner',
          viewKey: aleo.generateAccount().viewKey,
          apiKey: 'k',
        }),
      ).toThrow(/apiKey also needs consumerId/)
    })

    it('accepts an apiKey without a consumerId when a session supplies tokens', () => {
      const session = createProvableSession({ credentials: { consumerId: 'c', apiKey: 'k' } })
      expect(() =>
        aleo.createRemoteScanner({ url: 'https://api.provable.com/scanner', apiKey: 'k', session }),
      ).not.toThrow()
    })

    it('accepts neither, for an unauthenticated service', () => {
      expect(() => aleo.createRemoteScanner({ url: 'http://localhost:9000' })).not.toThrow()
    })
  })

  it('surfaces the unrecoverable-name error when the chosen name is taken', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"UNIQUE violation"}', { status: 409 })),
    )
    await expect(client('already-taken').authenticateProvableApi()).rejects.toThrow(
      /username 'already-taken' is already registered.*cannot be recovered/s,
    )
  }, 30_000)
})
