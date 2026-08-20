import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ApiAuth } from '@provablehq/sdk'
import { loadNetwork, type AleoSdk } from '../src/index.js'

/**
 * Pins the veil → Provable SDK boundary for record scanning: what each veil
 * credential configuration actually puts on the wire. Global fetch is stubbed,
 * so this runs in CI with no live service and no env. Requests are captured at
 * the first authenticated scanner call (the registration pubkey fetch) and the
 * flow is then cut short with a 500 — only the headers are under test.
 *
 * The session case is capability-gated: @provablehq/sdk 0.11.8 drops tokens
 * injected into a credential-less scanner (fixed upstream in c48a9059), so the
 * case probes the installed SDK and skips until the fixed release is resolved.
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

/** Whether the installed SDK sends tokens injected into a credential-less client. */
async function sdkSendsInjectedTokens(): Promise<boolean> {
  const auth = new ApiAuth({ mode: 'none' }, 'https://probe.example')
  auth.setJwtData({ jwt: 'Bearer probe', expiration: Date.now() + 3600_000 })
  const headers = await auth.headers()
  return headers.Authorization === 'Bearer probe'
}

const PRIVATE_KEY = 'APrivateKey1zkp6aEqdUdRpZs1fnfGBEitWZNzxNhPz4kb2W382nuX8G42'

describe('veil → SDK auth boundary (record scanning)', () => {
  let aleo: AleoSdk
  let sessionCapable: boolean

  beforeAll(async () => {
    aleo = await loadNetwork('testnet')
    sessionCapable = await sdkSendsInjectedTokens()
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

  it('a legacy pair on the scanner mints a JWT and sends it with the raw-key echo', async () => {
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
    const mint = calls.find((call) => call.url.includes('/jwts/cid'))
    expect(mint, 'no mint captured').toBeDefined()
    expect(mint!.headers['x-provable-api-key']).toBe('pair-key')
    const scan = firstScannerCall(calls)
    expect(scan, 'no scanner request captured').toBeDefined()
    expect(scan!.headers['authorization']).toBe('Bearer minted')
  })

  it('a client-shared session mints once and the scanner sends the session token', async (ctx) => {
    // The installed SDK may predate the session-injection fix (present from
    // the release after 0.11.8); skipping keeps the gap visible without
    // failing on a dependency this repo cannot fix.
    if (!sessionCapable) return ctx.skip()
    const calls: Captured[] = []
    stubFetch(calls)
    const scanner = aleo.createRemoteScanner({ url: 'https://api.example/scanner' })
    const { walletClient } = aleo.createAleoClient({
      privateKey: PRIVATE_KEY,
      networkUrl: 'https://api.example/v2',
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
