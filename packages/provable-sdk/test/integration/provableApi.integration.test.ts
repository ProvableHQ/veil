/**
 * Integration tests for Provable API authentication against the live service.
 *
 * Exercises the real `POST /jwts/{consumerId}` mint, the session's caching and
 * refresh, and the wiring that shares one session across delegated proving and
 * record scanning. Nothing is mocked.
 *
 * Gated behind VEIL_INTEGRATION=1 plus ALEO_CONSUMER_ID and ALEO_DPS_API_KEY.
 *
 *   VEIL_INTEGRATION=1 npx vitest run packages/provable-sdk/test/integration/provableApi.integration.test.ts
 *
 * Consumer registration is gated separately behind VEIL_PROVABLE_REGISTER=1,
 * because it creates a permanent consumer on the Provable API that cannot be
 * deleted and whose API key is issued once. Leave it off for routine runs.
 *
 * Env:
 *   ALEO_CONSUMER_ID          — consumer id for the mint
 *   ALEO_DPS_API_KEY          — API key for the mint
 *   VEIL_PROVABLE_API_URL     — API root (default: https://api.provable.com)
 *   ALEO_RSS_URL              — record scanner base (default: https://api.provable.com/scanner)
 *   VEIL_PROVABLE_REGISTER=1  — opt in to the registration test
 */
import { describe, it, expect } from 'vitest'
import {
  loadNetwork,
  registerProvableApi,
  createProvableSession,
  type AleoSdk,
  type ProvableApiCredentials,
  type ProvableCredentialStore,
} from '../../src/index.js'
import type { OwnedRecord, RecordProvider } from '@provablehq/veil-core'

const CONSUMER_ID = process.env.ALEO_CONSUMER_ID
const API_KEY = process.env.ALEO_DPS_API_KEY
const API_URL = process.env.VEIL_PROVABLE_API_URL ?? 'https://api.provable.com'
const SCANNER_URL = process.env.ALEO_RSS_URL ?? 'https://api.provable.com/scanner'
const NETWORK_URL = process.env.VEIL_API_URL ?? 'https://api.provable.com/v2'
const PROVER_URL = process.env.ALEO_DPS_URL ?? 'https://api.provable.com/prove'

const RUN = process.env.VEIL_INTEGRATION === '1' && !!CONSUMER_ID && !!API_KEY
const RUN_REGISTRATION = RUN && process.env.VEIL_PROVABLE_REGISTER === '1'

const CREDENTIALS: ProvableApiCredentials = {
  consumerId: CONSUMER_ID ?? '',
  apiKey: API_KEY ?? '',
}

/** A record provider this package did not build, so it cannot accept a session. */
function foreignRecordProvider(): RecordProvider {
  return {
    setAccount: () => {},
    requestRecords: async (): Promise<OwnedRecord[]> => [],
  }
}

describe.runIf(RUN)('Provable API authentication against the live service', () => {
  describe('minting', () => {
    it('mints a usable JWT from real credentials', async () => {
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: API_URL })
      const jwt = await session.getJwt()

      expect(jwt.jwt).toBeTruthy()
      // Stored verbatim as the API issues it, so it is ready to use as an
      // Authorization header value.
      expect(jwt.jwt).toMatch(/^Bearer /)
      // `exp` arrives in seconds; the session converts to milliseconds. A value
      // still in seconds would land in 1970 and fail this.
      expect(jwt.expiration).toBeGreaterThan(Date.now())
      expect(jwt.expiration).toBeLessThan(Date.now() + 90 * 24 * 60 * 60 * 1000)
    }, 30_000)

    it('resolves the configured credentials without registering', async () => {
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: API_URL })
      expect(await session.getCredentials()).toEqual(CREDENTIALS)
      expect(session.registeredConsumer()).toBe(false)
    }, 30_000)

    it('serves a cached token rather than minting per call', async () => {
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: API_URL })
      const first = await session.getJwt()
      const second = await session.getJwt()
      // Identity, not equality: a re-mint would build a new object even when
      // the service happened to return the same token.
      expect(second).toBe(first)
    }, 30_000)

    it('mints a replacement when forceRefresh is set', async () => {
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: API_URL })
      const first = await session.getJwt()
      const refreshed = await session.getJwt({ forceRefresh: true })
      expect(refreshed).not.toBe(first)
      expect(refreshed.expiration).toBeGreaterThan(Date.now())
    }, 30_000)

    it('collapses concurrent cold mints onto one token', async () => {
      const session = createProvableSession({ credentials: CREDENTIALS, baseUrl: API_URL })
      const [a, b, c] = await Promise.all([session.getJwt(), session.getJwt(), session.getJwt()])
      expect(a).toBe(b)
      expect(b).toBe(c)
    }, 30_000)

    it('surfaces the status when the API rejects the key', async () => {
      const session = createProvableSession({
        credentials: { consumerId: CREDENTIALS.consumerId, apiKey: 'not-a-real-key' },
        baseUrl: API_URL,
      })
      await expect(session.getJwt()).rejects.toThrow(/JWT mint failed \(HTTP \d{3}\)/)
    }, 30_000)

    it('mints for an unrecognized consumer id, because the key alone carries the identity', async () => {
      // Documents live behaviour rather than asserting a preference: the
      // `{consumerId}` path segment is not validated against the key. The
      // issued token's `iss` comes from the API key's own identity, so a
      // mismatched consumer id yields a *working* token that a downstream
      // service may still reject — which is the shape of the record scanner's
      // "No credentials found for given 'iss'" failure. A caller who wants the
      // pair validated has to check it themselves.
      const session = createProvableSession({
        credentials: { consumerId: 'nonexistent-consumer-veil-test', apiKey: CREDENTIALS.apiKey },
        baseUrl: API_URL,
      })
      const jwt = await session.getJwt()
      expect(jwt.jwt).toMatch(/^Bearer /)
      expect(jwt.expiration).toBeGreaterThan(Date.now())
    }, 30_000)
  })

  describe('client wiring', () => {
    let aleo: AleoSdk

    const loadSdk = async () => (aleo ??= await loadNetwork('testnet'))

    it('authenticates proving and record scanning from one session', async () => {
      const sdk = await loadSdk()
      const scanner = sdk.createRemoteScanner({ url: SCANNER_URL })
      const { walletClient } = sdk.createAleoClient({
        privateKey: sdk.generateAccount().privateKey,
        networkUrl: NETWORK_URL,
        proverUrl: PROVER_URL,
        consumerId: CREDENTIALS.consumerId,
        apiKey: CREDENTIALS.apiKey,
        records: scanner,
      })

      const result = await walletClient.authenticateProvableApi()

      expect(result.credentials).toEqual(CREDENTIALS)
      expect(result.registered).toBe(false)
      expect(result.expiration).toBeGreaterThan(Date.now())
      // Both paths carry the same session, which is the point of the wiring.
      expect(result.applied).toEqual({ proving: true, recordScanning: true })
    }, 60_000)

    it('reports record scanning unwired for a provider it cannot share with', async () => {
      const sdk = await loadSdk()
      const { walletClient } = sdk.createAleoClient({
        privateKey: sdk.generateAccount().privateKey,
        networkUrl: NETWORK_URL,
        proverUrl: PROVER_URL,
        consumerId: CREDENTIALS.consumerId,
        apiKey: CREDENTIALS.apiKey,
        records: foreignRecordProvider(),
      })

      const result = await walletClient.authenticateProvableApi()
      expect(result.applied).toEqual({ proving: true, recordScanning: false })
    }, 60_000)

    it('mints once for a client that authenticates twice', async () => {
      const sdk = await loadSdk()
      const { walletClient } = sdk.createAleoClient({
        privateKey: sdk.generateAccount().privateKey,
        networkUrl: NETWORK_URL,
        proverUrl: PROVER_URL,
        consumerId: CREDENTIALS.consumerId,
        apiKey: CREDENTIALS.apiKey,
      })

      const first = await walletClient.authenticateProvableApi()
      const second = await walletClient.authenticateProvableApi()
      // The cached token is reused, so the reported expiry is unchanged.
      expect(second.expiration).toBe(first.expiration)
    }, 60_000)

    it('replaces the token on a forced refresh', async () => {
      const sdk = await loadSdk()
      const { walletClient } = sdk.createAleoClient({
        privateKey: sdk.generateAccount().privateKey,
        networkUrl: NETWORK_URL,
        proverUrl: PROVER_URL,
        consumerId: CREDENTIALS.consumerId,
        apiKey: CREDENTIALS.apiKey,
      })

      await walletClient.authenticateProvableApi()
      const refreshed = await walletClient.authenticateProvableApi({ forceRefresh: true })
      expect(refreshed.expiration).toBeGreaterThan(Date.now())
    }, 60_000)

    it('leaves an unconfigured client with a session it has not resolved', async () => {
      const sdk = await loadSdk()
      const { walletClient } = sdk.createAleoClient({
        privateKey: sdk.generateAccount().privateKey,
        networkUrl: NETWORK_URL,
        proverUrl: PROVER_URL,
      })

      // A client given no credentials falls back to a process-lifetime memory
      // store, so the action exists and would register on demand. Deliberately
      // not called here: resolving it would create a real consumer whose key is
      // discarded when this process exits. The registration path is covered
      // under VEIL_PROVABLE_REGISTER below.
      expect(typeof walletClient.authenticateProvableApi).toBe('function')
    }, 30_000)
  })

  describe('credential store', () => {
    it('loads stored credentials and mints from them, without registering', async () => {
      const sdk = await loadNetwork('testnet')
      const saved: ProvableApiCredentials[] = []
      const store: ProvableCredentialStore = {
        load: () => CREDENTIALS,
        save: (c) => void saved.push(c),
      }

      const { walletClient } = sdk.createAleoClient({
        privateKey: sdk.generateAccount().privateKey,
        networkUrl: NETWORK_URL,
        proverUrl: PROVER_URL,
        credentialStore: store,
      })

      const result = await walletClient.authenticateProvableApi()
      expect(result.credentials).toEqual(CREDENTIALS)
      expect(result.registered).toBe(false)
      expect(result.expiration).toBeGreaterThan(Date.now())
      // Nothing was registered, so nothing should have been written back.
      expect(saved).toEqual([])
    }, 60_000)
  })
})

/**
 * Registration creates a permanent consumer whose key is issued once, so this
 * runs only under an explicit opt-in rather than with the rest of the suite.
 */
describe.runIf(RUN_REGISTRATION)('Provable API consumer registration (creates real state)', () => {
  it('registers a consumer whose credentials mint a working JWT', async () => {
    const username = `veil-it-${Date.now().toString(36)}`
    const credentials = await registerProvableApi({ username, baseUrl: API_URL })

    expect(credentials.consumerId).toBeTruthy()
    expect(credentials.apiKey).toBeTruthy()

    // The credentials are only meaningful if they authenticate — mint with them.
    const session = createProvableSession({ credentials, baseUrl: API_URL })
    const jwt = await session.getJwt()
    expect(jwt.jwt).toMatch(/^Bearer /)
    expect(jwt.expiration).toBeGreaterThan(Date.now())
  }, 60_000)

  it('registers through a client when the store is empty, and saves the credentials', async () => {
    const sdk = await loadNetwork('testnet')
    const saved: ProvableApiCredentials[] = []
    const store: ProvableCredentialStore = {
      load: () => undefined,
      save: (c) => void saved.push(c),
    }

    const { walletClient } = sdk.createAleoClient({
      privateKey: sdk.generateAccount().privateKey,
      networkUrl: NETWORK_URL,
      proverUrl: PROVER_URL,
      credentialStore: store,
    })

    const result = await walletClient.authenticateProvableApi()
    expect(result.registered).toBe(true)
    // Persisted before the call returned — the key is unrecoverable otherwise.
    expect(saved).toEqual([result.credentials])
    expect(result.expiration).toBeGreaterThan(Date.now())
  }, 60_000)

  it('rejects a username already taken', async () => {
    const username = `veil-it-dup-${Date.now().toString(36)}`
    await registerProvableApi({ username, baseUrl: API_URL })
    await expect(registerProvableApi({ username, baseUrl: API_URL })).rejects.toThrow(
      /registration failed \(HTTP \d{3}\)/,
    )
  }, 60_000)
})
