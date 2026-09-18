import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadNetwork, type AleoSdk } from '../src/index.js'

/**
 * Pins the veil → Provable SDK boundary for record scanning: what each veil
 * credential configuration actually puts on the wire. Global fetch is stubbed,
 * so this runs in CI with no live service and no env. Requests are captured at
 * the first scanner call (the registration pubkey fetch) and the flow is then
 * cut short with a 500 — only the headers are under test.
 *
 * The default gateway needs no consumer and mints no JWT, so an unconfigured
 * scanner adds no header. A provisioned key rides as X-API-Key. A legacy
 * consumer pair aimed at a legacy gateway mints once through the veil session
 * at that gateway's origin and rides as Authorization; aimed at the default
 * gateway it mints nothing. The Provable SDK itself must never mint.
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
      if (url.includes('/jwts/')) {
        return new Response(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }), {
          status: 201,
          headers: { authorization: 'Bearer minted' },
        })
      }
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

  it('an unconfigured client scans with no auth headers, no mint, and no registration', async () => {
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

  it('a legacy pair on the scanner mints at the Provable API root and rides as Authorization', async () => {
    const calls: Captured[] = []
    stubFetch(calls)
    const scanner = aleo.createRemoteScanner({
      url: 'https://api.example/scanner',
      consumerId: 'cid',
      apiKey: 'pair-key',
    })
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY,
      networkUrl: 'https://api.example/v2',
      provingMode: 'local',
      records: scanner,
    })
    await walletClient.requestRecords({ program: 'credits.aleo' }).catch(() => undefined)
    const mints = calls.filter((call) => call.url.includes('/jwts/'))
    expect(mints.map((m) => m.url)).toEqual(['https://api.example/jwts/cid'])
    expect(mints[0]!.headers['x-provable-api-key']).toBe('pair-key')
    const scan = firstScannerCall(calls)
    expect(scan, 'no scanner request captured').toBeDefined()
    expect(scan!.headers['authorization']).toBe('Bearer minted')
    // The pair never reaches the Provable SDK, so it cannot mint at the scanner origin.
    expect(scan!.headers['x-provable-api-key']).toBeUndefined()
  })

  it('a legacy pair aimed at the default gateway is carried but never minted or sent', async () => {
    const calls: Captured[] = []
    stubFetch(calls)
    const scanner = aleo.createRemoteScanner({
      url: 'https://edge.provable.com/api/scanner',
      consumerId: 'cid',
      apiKey: 'pair-key',
    })
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY,
      networkUrl: 'https://edge.provable.com/api/v2',
      provingMode: 'local',
      records: scanner,
    })
    await walletClient.requestRecords({ program: 'credits.aleo' }).catch(() => undefined)
    expect(calls.some((call) => call.url.includes('/jwts/'))).toBe(false)
    const scan = firstScannerCall(calls)
    expect(scan, 'no scanner request captured').toBeDefined()
    expect(scan!.headers['authorization']).toBeUndefined()
    expect(scan!.headers['x-provable-api-key']).toBeUndefined()
  })

  it('a legacy pair on the client is shared with the scanner and mints once', async () => {
    const calls: Captured[] = []
    stubFetch(calls)
    const scanner = aleo.createRemoteScanner({ url: 'https://api.example/scanner' })
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY,
      networkUrl: 'https://api.example/v2',
      proverUrl: 'https://api.example/prove',
      apiKey: 'pair-key',
      consumerId: 'cid',
      records: scanner,
    })
    await walletClient.requestRecords({ program: 'credits.aleo' }).catch(() => undefined)
    const mints = calls.filter((call) => call.url.includes('/jwts/'))
    expect(mints).toHaveLength(1)
    const scan = firstScannerCall(calls)
    expect(scan, 'no scanner request captured').toBeDefined()
    expect(scan!.headers['authorization']).toBe('Bearer minted')
    expect(scan!.headers['x-provable-api-key']).toBeUndefined()
  })
})
