import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest'
import {
  DEVNODE_PRIVATE_KEY,
  loadNetwork,
  createProvableSession,
  type AleoSdk,
  type ProvableKeyedAuth,
  type ProvingConfigWithSession,
} from '../src/index.js'

/**
 * Provisioned-key ("api-key") auth for the edge gateway, which has no
 * consumer registration or JWT minting. These tests cover the mode's veil
 * wiring: mutual exclusion with the session model, the keyed auth riding the
 * proving config, and the client refusing lifecycle calls that keyed auth
 * does not have. Header emission itself is covered by the Provable SDK's own
 * tests and by live integration against the edge gateway.
 */
const KEYED: ProvableKeyedAuth = { mode: 'api-key', value: 'edge-key' }
const PRIVATE_KEY = DEVNODE_PRIVATE_KEY

describe('keyed auth wiring', () => {
  let aleo: AleoSdk

  beforeAll(async () => {
    aleo = await loadNetwork('testnet')
  }, 60_000)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('createProvingConfig carries the keyed auth and rejects the session model beside it', () => {
    const config = aleo.createProvingConfig({ mode: 'delegated', networkUrl: 'http://localhost:3030', auth: KEYED })
    expect((config as ProvingConfigWithSession).keyedAuth).toEqual(KEYED)
    expect((config as ProvingConfigWithSession).session).toBeUndefined()

    expect(() =>
      aleo.createProvingConfig({
        mode: 'delegated',
        networkUrl: 'http://localhost:3030',
        auth: KEYED,
        session: createProvableSession(),
      }),
    ).toThrow(/mutually exclusive/)
    expect(() =>
      aleo.createProvingConfig({
        mode: 'delegated',
        networkUrl: 'http://localhost:3030',
        auth: KEYED,
        apiKey: 'k',
        consumerId: 'c',
      }),
    ).toThrow(/mutually exclusive/)
  })

  it('createRemoteScanner and createStandaloneScanner reject consumer options beside keyed auth', () => {
    expect(() => aleo.createRemoteScanner({ auth: KEYED, apiKey: 'k', consumerId: 'c' })).toThrow(
      /mutually exclusive/,
    )
    expect(() =>
      aleo.createStandaloneScanner({
        viewKey: 'AViewKey1nPQW8P83ajkMBHQwYjbUfjGHVSkBQ5wctpJJmQvW1SyZ',
        auth: KEYED,
        session: createProvableSession(),
      }),
    ).toThrow(/mutually exclusive/)
  })

  it('createAleoClient rejects every consumer option beside keyed auth', () => {
    for (const extra of [
      { apiKey: 'k', consumerId: 'c' },
      { username: 'name' },
      { credentialStore: { load: () => undefined, save: () => undefined } },
      { session: createProvableSession() },
    ]) {
      expect(() =>
        aleo.createAleoClient({ privateKey: PRIVATE_KEY, networkUrl: 'http://localhost:3030', auth: KEYED, ...extra }),
      ).toThrow(/mutually exclusive/)
    }
  })

  it('a keyed client shares the auth with its record provider and builds no session', () => {
    const shared: ProvableKeyedAuth[] = []
    const records = {
      setAccount: vi.fn(),
      setAuth: (auth: ProvableKeyedAuth) => shared.push(auth),
      setSession: vi.fn(),
      requestRecords: vi.fn(async () => []),
    }
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY,
      networkUrl: 'http://localhost:3030',
      auth: KEYED,
      records,
    })
    expect(shared).toEqual([KEYED])
    expect(records.setSession).not.toHaveBeenCalled()
    expect((walletClient.proving as ProvingConfigWithSession).keyedAuth).toEqual(KEYED)
    expect((walletClient.proving as ProvingConfigWithSession).session).toBeUndefined()
  })

  it('authenticateProvableApi refuses on a keyed client — there is no lifecycle to resolve', async () => {
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY,
      networkUrl: 'http://localhost:3030',
      auth: KEYED,
    })
    await expect(walletClient.authenticateProvableApi()).rejects.toThrow(/provisioned API key/)
  })
})
