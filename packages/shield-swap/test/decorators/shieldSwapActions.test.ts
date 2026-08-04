import { describe, it, expect } from 'vitest'
import { createClient, custom } from '@provablehq/veil-core'
import { shieldSwapActions } from '../../src/decorators/shieldSwapActions.js'
import { ApiClient } from '../../src/api/client.js'

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
