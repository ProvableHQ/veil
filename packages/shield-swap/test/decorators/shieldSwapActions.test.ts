import { describe, it, expect } from 'vitest'
import { createClient, custom } from '@veil/core'
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
    const client = baseClient(() => null).extend(shieldSwapActions({ program: 'shield_swap_v0_0_1.aleo' }))
    // Intercept via a second extension to observe the underlying request:
    // simpler — spy through the transport by re-extending with a probe.
    const probe = baseClient((method, params) => {
      programs.push((params as { programId?: string })?.programId ?? '')
      return null
    }).extend(shieldSwapActions({ program: 'shield_swap_v0_0_1.aleo' }))

    await probe.getPool({ poolKey: '1field' })
    await probe.getPool({ poolKey: '1field', program: 'shield_swap_v9.aleo' })
    expect(programs).toEqual(['shield_swap_v0_0_1.aleo', 'shield_swap_v9.aleo'])
    expect(client).toBeTruthy()
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
