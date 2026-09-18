import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadNetwork, type AleoSdk } from '../src/index.js'

/**
 * Pins the veil → Provable SDK boundary for record scanning: what each veil
 * credential configuration actually puts on the wire. Global fetch is stubbed,
 * so this runs in CI with no live service and no env. Requests are captured at
 * the first scanner call (the registration pubkey fetch) and the flow is then
 * cut short with a 500 — only the headers are under test.
 *
 * The gateway needs no consumer and mints no JWT, so the only header a veil
 * configuration may add is a provisioned key. A legacy consumer pair must
 * produce no mint and no Authorization header.
 */

type Captured = { url: string; headers: Record<string, string> }

function stubFetch(calls: Captured[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      const headers: Record<string, string> = {}
      new Headers(init?.headers ?? (input instanceof Request ? input.headers : {})).forEach(
        (value, key) => {
          headers[key] = value
        },
      )
      calls.push({ url, headers })
      // Cut the flow after the headers are captured.
      return new Response('{}', { status: 500 })
    }),
  )
}

/** The first request aimed at the scanner service, where auth headers must ride. */
function firstScannerCall(calls: Captured[]): Captured | undefined {
  return calls.find((call) => call.url.includes('/scanner/'))
}

const PRIVATE_KEY = 'APrivateKey1zkp6aEqdUdRpZs1fnfGBEitWZNzxNhPz4kb2W382nuX8G42'

describe('veil → SDK auth boundary (record scanning)', () => {
  let aleo: AleoSdk

  beforeAll(async () => {
    aleo = await loadNetwork('testnet')
  }, 60_000)

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keyed auth rides every scanner request as X-API-Key, with no mint', async () => {
    const calls: Captured[] = []
    stubFetch(calls)
    const scanner = aleo.createRemoteScanner({
      url: 'https://edge.example/api/scanner',
      auth: { mode: 'api-key', value: 'edge-key' },
    })
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY,
      networkUrl: 'https://edge.example/api/v2',
      auth: { mode: 'api-key', value: 'edge-key' },
      records: scanner,
    })
    await walletClient.requestRecords({ program: 'credits.aleo' }).catch(() => undefined)
    const scan = firstScannerCall(calls)
    expect(scan, 'no scanner request captured').toBeDefined()
    expect(scan!.headers['x-api-key']).toBe('edge-key')
    expect(scan!.headers['authorization']).toBeUndefined()
    expect(calls.some((call) => call.url.includes('/jwts/'))).toBe(false)
  })

  it('an unconfigured client scans with no auth headers and no mint', async () => {
    const calls: Captured[] = []
    stubFetch(calls)
    const scanner = aleo.createRemoteScanner({ url: 'https://edge.example/api/scanner' })
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY,
      networkUrl: 'https://edge.example/api/v2',
      records: scanner,
    })
    await walletClient.requestRecords({ program: 'credits.aleo' }).catch(() => undefined)
    const scan = firstScannerCall(calls)
    expect(scan, 'no scanner request captured').toBeDefined()
    expect(scan!.headers['authorization']).toBeUndefined()
    expect(scan!.headers['x-api-key']).toBeUndefined()
    expect(calls.some((call) => call.url.includes('/jwts/') || call.url.includes('/consumers'))).toBe(false)
  })

  it('a legacy pair on the scanner is carried but never minted or sent', async () => {
    const calls: Captured[] = []
    stubFetch(calls)
    const scanner = aleo.createRemoteScanner({
      url: 'https://edge.example/api/scanner',
      consumerId: 'cid',
      apiKey: 'pair-key',
    })
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY,
      networkUrl: 'https://edge.example/api/v2',
      provingMode: 'local',
      records: scanner,
    })
    await walletClient.requestRecords({ program: 'credits.aleo' }).catch(() => undefined)
    expect(calls.some((call) => call.url.includes('/jwts/'))).toBe(false)
    const scan = firstScannerCall(calls)
    expect(scan, 'no scanner request captured').toBeDefined()
    expect(scan!.headers['authorization']).toBeUndefined()
    expect(scan!.headers['x-provable-api-key']).toBeUndefined()
    expect(scan!.headers['x-api-key']).toBeUndefined()
  })

  it('a legacy pair on the client is shared with the scanner without minting', async () => {
    const calls: Captured[] = []
    stubFetch(calls)
    const scanner = aleo.createRemoteScanner({ url: 'https://edge.example/api/scanner' })
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY,
      networkUrl: 'https://edge.example/api/v2',
      apiKey: 'pair-key',
      consumerId: 'cid',
      records: scanner,
    })
    await walletClient.requestRecords({ program: 'credits.aleo' }).catch(() => undefined)
    expect(calls.some((call) => call.url.includes('/jwts/'))).toBe(false)
    const scan = firstScannerCall(calls)
    expect(scan, 'no scanner request captured').toBeDefined()
    expect(scan!.headers['authorization']).toBeUndefined()
    expect(scan!.headers['x-provable-api-key']).toBeUndefined()
  })
})
