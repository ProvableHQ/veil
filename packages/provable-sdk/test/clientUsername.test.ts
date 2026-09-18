import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest'
import {
  loadNetwork,
  memoryCredentialStore,
  createProvableSession,
  DEFAULT_PROVER_URL,
  type AleoSdk,
} from '../src/index.js'

/**
 * What a client does with the credential options now that the gateway needs
 * none of them. Nothing may register a consumer or mint a JWT, whatever the
 * caller passes; the options are carried for compatibility and reported back
 * by `authenticateProvableApi`, and that is all.
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

  it('reports a configured pair without minting from it', async () => {
    const urls = forbidFetch()
    const result = await client({
      consumerId: 'existing-consumer',
      apiKey: 'existing-key',
      username: 'would-be-ignored',
    }).authenticateProvableApi()
    expect(urls).toEqual([])
    expect(result.registered).toBe(false)
    expect(result.credentials).toEqual({ consumerId: 'existing-consumer', apiKey: 'existing-key' })
  }, 30_000)

  it('reports stored credentials without minting from them', async () => {
    const urls = forbidFetch()
    const store = memoryCredentialStore({ consumerId: 'stored', apiKey: 'stored-key' })
    const result = await client({ credentialStore: store }).authenticateProvableApi()
    expect(urls).toEqual([])
    expect(result.credentials).toEqual({ consumerId: 'stored', apiKey: 'stored-key' })
  }, 30_000)

  it('carries a bare pair on the proving config as an inert session', async () => {
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
