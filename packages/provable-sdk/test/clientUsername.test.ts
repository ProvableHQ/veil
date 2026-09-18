import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest'
import {
  loadNetwork,
  memoryCredentialStore,
  createProvableSession,
  DEFAULT_PROVER_URL,
  type AleoSdk,
} from '../src/index.js'

/**
 * What a client does with the credential options. The default gateway needs
 * none, so nothing may register a consumer or mint a JWT there, whatever the
 * caller passes. A pair together with legacy URLs selects the legacy JWT model
 * and mints at the gateway those URLs name.
 */
describe('createAleoClient credentials', () => {
  let aleo: AleoSdk

  beforeAll(async () => {
    // Loaded before the fetch stub goes up, so WASM fetching is unaffected.
    aleo = await loadNetwork('testnet')
  }, 60_000)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Records every request; the tests assert there are none. */
  function forbidFetch() {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        urls.push(url.toString())
        throw new Error(`unexpected request: ${url.toString()}`)
      }),
    )
    return urls
  }

  const client = (extra: Record<string, unknown> = {}) =>
    aleo.createAleoClient({
      privateKey: aleo.generateAccount().privateKey,
      networkUrl: 'https://edge.provable.com/api/v2',
      ...extra,
    }).walletClient

  it('registers nothing for a client with no credential options', async () => {
    const urls = forbidFetch()
    const result = await client().authenticateProvableApi()
    expect(urls).toEqual([])
    expect(result).toEqual({
      credentials: undefined,
      expiration: undefined,
      registered: false,
      applied: { proving: true, recordScanning: false },
    })
  }, 30_000)

  it('registers nothing for an empty credential store, and ignores username', async () => {
    const urls = forbidFetch()
    const username = vi.fn(() => 'never-used')
    const result = await client({ credentialStore: memoryCredentialStore(), username }).authenticateProvableApi()
    expect(urls).toEqual([])
    expect(username).not.toHaveBeenCalled()
    expect(result.credentials).toBeUndefined()
    expect(result.registered).toBe(false)
  }, 30_000)

  it('carries a configured pair on the default gateway without minting from it', async () => {
    const urls = forbidFetch()
    const result = await client({
      consumerId: 'existing-consumer',
      apiKey: 'existing-key',
      username: 'would-be-ignored',
    }).authenticateProvableApi()
    expect(urls).toEqual([])
    expect(result.registered).toBe(false)
    expect(result.expiration).toBeUndefined()
    expect(result.credentials).toEqual({ consumerId: 'existing-consumer', apiKey: 'existing-key' })
  }, 30_000)

  it('mints from a configured pair at the legacy gateway the URLs name', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        urls.push(url.toString())
        return new Response(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }), {
          status: 201,
          headers: { authorization: 'Bearer legacy' },
        })
      }),
    )
    const result = await client({
      networkUrl: 'https://api.provable.com/v2',
      proverUrl: 'https://api.provable.com/prove',
      consumerId: 'existing-consumer',
      apiKey: 'existing-key',
    }).authenticateProvableApi()
    expect(urls).toEqual(['https://api.provable.com/jwts/existing-consumer'])
    expect(result.expiration).toBeGreaterThan(Date.now())
    expect(result.registered).toBe(false)
  }, 30_000)

  it('ignores a non-default node URL: only the prover names a JWT gateway', async () => {
    const urls = forbidFetch()
    const result = await client({
      networkUrl: 'http://localhost:3030',
      consumerId: 'c-1',
      apiKey: 'k-1',
    }).authenticateProvableApi()
    expect(urls).toEqual([])
    expect(result.expiration).toBeUndefined()
  }, 30_000)

  it('mints for a legacy scanner even when the prover is the default', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        urls.push(url.toString())
        return new Response(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }), {
          status: 201,
          headers: { authorization: 'Bearer legacy' },
        })
      }),
    )
    const result = await client({
      records: aleo.createRemoteScanner({ url: 'https://api.provable.com/scanner' }),
      consumerId: 'c-1',
      apiKey: 'k-1',
    }).authenticateProvableApi()
    expect(urls).toEqual(['https://api.provable.com/jwts/c-1'])
    expect(result.applied).toEqual({ proving: true, recordScanning: true })
  }, 30_000)

  it('derives the mint root from a legacy prover even when the node URL is the default', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        urls.push(url.toString())
        return new Response(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }), {
          status: 201,
          headers: { authorization: 'Bearer legacy' },
        })
      }),
    )
    const proving = aleo.createProvingConfig({
      mode: 'delegated',
      networkUrl: 'https://edge.provable.com/api/v2',
      proverUrl: 'https://legacy.example/prove',
      consumerId: 'c-1',
      apiKey: 'k-1',
    })
    await expect(proving.session!.getJwt()).resolves.toMatchObject({ jwt: 'Bearer legacy' })
    expect(urls).toEqual(['https://legacy.example/jwts/c-1'])
  })

  it('reports stored credentials without minting from them', async () => {
    const urls = forbidFetch()
    const store = memoryCredentialStore({ consumerId: 'stored', apiKey: 'stored-key' })
    const result = await client({ credentialStore: store }).authenticateProvableApi()
    expect(urls).toEqual([])
    expect(result.credentials).toEqual({ consumerId: 'stored', apiKey: 'stored-key' })
  }, 30_000)

  it('carries a bare pair on a default-gateway proving config as an inert session', async () => {
    const urls = forbidFetch()
    const proving = aleo.createProvingConfig({
      mode: 'delegated',
      networkUrl: 'https://edge.provable.com/api/v2',
      consumerId: 'c-1',
      apiKey: 'k-1',
    })
    expect(proving.session).toBeDefined()
    await expect(proving.session!.getJwt()).resolves.toBeUndefined()
    await expect(proving.session!.getCredentials()).resolves.toEqual({ consumerId: 'c-1', apiKey: 'k-1' })
    expect(urls).toEqual([])
  })

  describe('scanner credential validation', () => {
    it('rejects an apiKey without a consumerId on a remote scanner', () => {
      // A lone key is ambiguous between half a legacy pair and a provisioned
      // key that belongs in `auth`; refusing beats guessing.
      expect(() =>
        aleo.createRemoteScanner({ url: 'https://edge.provable.com/api/scanner', apiKey: 'k' }),
      ).toThrow(/apiKey also needs consumerId/)
    })

    it('rejects an apiKey without a consumerId on a standalone scanner', () => {
      expect(() =>
        aleo.createStandaloneScanner({
          url: 'https://edge.provable.com/api/scanner',
          viewKey: aleo.generateAccount().viewKey,
          apiKey: 'k',
        }),
      ).toThrow(/apiKey also needs consumerId/)
    })

    it('accepts an apiKey without a consumerId when a session is supplied', () => {
      const session = createProvableSession({ credentials: { consumerId: 'c', apiKey: 'k' } })
      expect(() =>
        aleo.createRemoteScanner({ url: 'https://edge.provable.com/api/scanner', apiKey: 'k', session }),
      ).not.toThrow()
    })

    it('accepts neither, for the open gateway', () => {
      expect(() => aleo.createRemoteScanner({ url: 'http://localhost:9000' })).not.toThrow()
    })
  })

  describe('default service URLs', () => {
    it('builds a remote scanner with no options at all', () => {
      expect(() => aleo.createRemoteScanner()).not.toThrow()
    })

    it('builds a standalone scanner from just a view key', () => {
      expect(() =>
        aleo.createStandaloneScanner({ viewKey: aleo.generateAccount().viewKey }),
      ).not.toThrow()
    })

    it('gives a client with nothing configured a working prover endpoint', () => {
      const { walletClient } = aleo.createAleoClient({
        privateKey: aleo.generateAccount().privateKey,
        networkUrl: 'https://edge.provable.com/api/v2',
        records: aleo.createRemoteScanner(),
      })
      expect(walletClient.proving.mode).toBe('delegated')
      expect(walletClient.proving.url).toBe(`${DEFAULT_PROVER_URL}/testnet`)
    }, 30_000)
  })
})
