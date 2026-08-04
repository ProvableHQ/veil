import { describe, it, expect } from 'vitest'
import { createClient, custom, http } from '@provablehq/veil-core'
import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { ApiClient, SHIELD_SWAP_API_URLS } from '../../src/api/client.js'

const POOL_PLAINTEXT =
  '{\n  token0: 11field,\n  token1: 22field,\n  fee: 3000u16,\n  enabled: true,\n  scale0: 1u128,\n  scale1: 1u128\n}'

function baseClient(script: (method: string, params?: { mapping?: string }) => unknown) {
  return createClient({
    transport: custom({ request: async ({ method, params }) => script(method, params as { mapping?: string }) }),
  })
}

describe('shieldSwapActions', () => {
  it('extends a client with chain reads routed through the base transport', async () => {
    const client = baseClient((method, params) =>
      method === 'getMappingValue' && params?.mapping === 'pools' ? POOL_PLAINTEXT : null,
    ).extend(shieldSwapActions())

    const pool = await client.getPool({ poolKey: '1field' })
    expect(pool!.fee).toBe(3000)
    // Core surface stays available on the extended client.
    expect(typeof client.extend).toBe('function')
  })

  it('threads the client-level program default; per-call still overrides', async () => {
    const programs: string[] = []
    const client = baseClient(() => null).extend(shieldSwapActions({ program: 'shield_swap_alt.aleo' }))
    // Intercept via a second extension to observe the underlying request:
    // simpler — spy through the transport by re-extending with a probe.
    const probe = baseClient((method, params) => {
      programs.push((params as { programId?: string })?.programId ?? '')
      return null
    }).extend(shieldSwapActions({ program: 'shield_swap_alt.aleo' }))

    await probe.getPool({ poolKey: '1field' })
    await probe.getPool({ poolKey: '1field', program: 'shield_swap_v9.aleo' })
    expect(programs).toEqual(['shield_swap_alt.aleo', 'shield_swap_v9.aleo'])
    expect(client).toBeTruthy()
  })

  it('authenticateShieldSwap signs the DEX API challenge with the client account', async () => {
    const requests: Array<{ url: string; body: unknown }> = []
    const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
      requests.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
      const path = new URL(String(url)).pathname
      if (path === '/auth/challenge') return new Response(JSON.stringify({ data: { message: 'msg', nonce: 'n' } }))
      return new Response(JSON.stringify({ data: { token: 'jwt123' } }))
    }) as unknown as typeof fetch

    const account = {
      type: 'local',
      address: 'aleo1me',
      signMessage: async (m: Uint8Array) => new TextEncoder().encode(`signed:${new TextDecoder().decode(m)}`),
    }
    const client = createClient({
      transport: custom({ request: async () => null }),
      account: account as never,
    }).extend(shieldSwapActions({ api: { baseUrl: 'https://x.example', fetch: fetchImpl } }))

    const jwt = await client.authenticateShieldSwap()
    expect(jwt).toBe('jwt123')
    expect(requests[1]!.body).toEqual({ address: 'aleo1me', signature: 'signed:msg' })
  })

  it('authenticateShieldSwap fails actionably without an account', async () => {
    const client = baseClient(() => null).extend(shieldSwapActions({ api: { baseUrl: 'https://x.example' } }))
    await expect(client.authenticateShieldSwap()).rejects.toThrow(/account/)
  })

  it('keeps authenticateApi working as a deprecated alias', async () => {
    const fetchImpl = (async (url: URL | string) => {
      const path = new URL(String(url)).pathname
      if (path === '/auth/challenge') return new Response(JSON.stringify({ data: { message: 'msg', nonce: 'n' } }))
      return new Response(JSON.stringify({ data: { token: 'jwt123' } }))
    }) as unknown as typeof fetch

    const account = {
      type: 'local',
      address: 'aleo1me',
      signMessage: async (m: Uint8Array) => new TextEncoder().encode(`signed:${new TextDecoder().decode(m)}`),
    }
    const client = createClient({
      transport: custom({ request: async () => null }),
      account: account as never,
    }).extend(shieldSwapActions({ api: { baseUrl: 'https://x.example', fetch: fetchImpl } }))

    // The old name must keep behaving identically until the next major, so a
    // caller upgrading a minor is not broken by the rename.
    await expect(client.authenticateApi()).resolves.toBe('jwt123')
  })

  it('exposes getOwnedPositions/getOwnedPosition and threads the program default into the record scan', async () => {
    const scannedPrograms: string[] = []
    const client = createClient({
      transport: custom({
        request: async ({ method, params }) => {
          if (method === 'requestRecords') {
            scannedPrograms.push((params as { program: string }).program)
            return []
          }
          return null
        },
      }),
      account: { type: 'rpc' } as never,
    }).extend(shieldSwapActions({ program: 'shield_swap_alt.aleo' }))

    expect(await client.getOwnedPositions()).toEqual([])
    expect(await client.getOwnedPosition({ positionTokenId: '1field' })).toBeNull()
    expect(scannedPrograms).toEqual(['shield_swap_alt.aleo', 'shield_swap_alt.aleo'])
  })

  it('exposes a configured API, adopts a preconstructed one, and fails actionably without one', () => {
    const configured = baseClient(() => null).extend(shieldSwapActions({ api: { baseUrl: 'https://x.example' } }))
    expect(configured.api.baseUrl).toBe('https://x.example')

    const prebuilt = new ApiClient({ baseUrl: 'https://y.example' })
    const adopted = baseClient(() => null).extend(shieldSwapActions({ api: prebuilt }))
    expect(adopted.api).toBe(prebuilt)

    const chainOnly = baseClient(() => null).extend(shieldSwapActions())
    expect(() => chainOnly.api.getPools).toThrow(/No DEX API configured/)
  })
})

describe('DEX API host derivation', () => {
  /** Records the origin each request went to. */
  const spy = () => {
    const urls: string[] = []
    const fetchImpl = (async (url: URL | string) => {
      urls.push(new URL(String(url)).origin)
      return new Response(JSON.stringify({ data: [] }))
    }) as unknown as typeof fetch
    return { urls, fetchImpl }
  }

  const clientOn = (network: 'mainnet' | 'testnet', fetchImpl: typeof fetch) =>
    createClient({ transport: http('https://api.provable.com/v2', { network }) }).extend(
      shieldSwapActions({ api: { fetch: fetchImpl } }),
    )

  it('derives the testnet host from a testnet client', async () => {
    const { urls, fetchImpl } = spy()
    await clientOn('testnet', fetchImpl).api.getPools()
    expect(urls).toEqual([SHIELD_SWAP_API_URLS.testnet])
  })

  it('derives the mainnet host from a mainnet client', async () => {
    const { urls, fetchImpl } = spy()
    await clientOn('mainnet', fetchImpl).api.getPools()
    // A mainnet client reaching the testnet host would read pools that do not
    // exist on the program it proves against.
    expect(urls).toEqual([SHIELD_SWAP_API_URLS.mainnet])
  })

  it('lets an explicit baseUrl override the derived host', async () => {
    const { urls, fetchImpl } = spy()
    const client = createClient({
      transport: http('https://api.provable.com/v2', { network: 'testnet' }),
    }).extend(shieldSwapActions({ api: { baseUrl: 'https://local.example', fetch: fetchImpl } }))
    await client.api.getPools()
    expect(urls).toEqual(['https://local.example'])
  })

  it('keeps deriving the host when baseUrl is passed but undefined', async () => {
    const { urls, fetchImpl } = spy()
    // The shape a caller writes as `baseUrl: process.env.VEIL_DEX_API_URL` with
    // the variable unset. The key is present, so a spread would let it beat the
    // derived host and fall back to the deprecated testnet constant — pointing a
    // mainnet client at testnet, silently.
    const client = createClient({
      transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
    }).extend(shieldSwapActions({ api: { baseUrl: undefined, fetch: fetchImpl } }))
    await client.api.getPools()
    expect(urls).toEqual([SHIELD_SWAP_API_URLS.mainnet])
  })

  it('follows switchChain, because the host is resolved per request', async () => {
    const { urls, fetchImpl } = spy()
    const transport = http('https://api.provable.com/v2', { network: 'testnet' })
    const client = createClient({ transport }).extend(
      shieldSwapActions({ api: { fetch: fetchImpl } }),
    )
    await client.api.getPools()
    // switchChain mutates the transport's network in place; the API host has to
    // move with it rather than stay on the network the client started from.
    transport.config.network = 'mainnet'
    await client.api.getPools()
    expect(urls).toEqual([SHIELD_SWAP_API_URLS.testnet, SHIELD_SWAP_API_URLS.mainnet])
  })
})

describe('insert hints and the API', () => {
  const TICK_ENTRY =
    '{\n  liquidity_gross: 1u128,\n  liquidity_net: 1i128,\n' +
    '  fee_growth_outside0_x_128: { lo: 0u128, hi: 0u128 },\n' +
    '  fee_growth_outside1_x_128: { lo: 0u128, hi: 0u128 },\n' +
    '  prev: 0i32,\n  next: 900i32,\n  initialized: true\n}'

  it('does not call the API for ticks when the WASM peer can walk the chain', async () => {
    // The tick list is attached as a supplier rather than a fetched array, so
    // the request only happens on the branch that needs it. A client that can
    // derive tick keys must pay nothing for the fallback being wired up.
    const paths: string[] = []
    const fetchImpl = (async (url: URL | string) => {
      paths.push(new URL(String(url)).pathname)
      return new Response(JSON.stringify({ data: [] }))
    }) as unknown as typeof fetch

    const client = createClient({
      transport: custom({
        request: async ({ params }) =>
          (params as { mapping?: string })?.mapping === 'ticks' ? TICK_ENTRY : null,
      }),
    }).extend(shieldSwapActions({ api: { fetch: fetchImpl } }))

    // @provablehq/sdk is installed here, so this takes the chain-walk branch.
    const hint = await client.pickInsertHint({ poolKey: '1field', targetTick: 300 })
    expect(typeof hint).toBe('number')
    expect(paths.filter((p) => p.includes('initialized-ticks'))).toEqual([])
  })
})
