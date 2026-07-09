import { describe, it, expect } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import type { ApiClient } from '../../src/api/client.js'
import { shieldSwapAgentToolSchemas, createShieldSwapAgentTools } from '../../src/agent/index.js'

// Real captured testnet pool plaintext (ETHx/USDC) — has bigint fields (scale0/scale1).
const POOL_PLAINTEXT =
  '{\n  token0: 122352848155208110005843045field,\n  token1: 15594200448253854747971580789field,\n  fee: 10000u16,\n  enabled: true,\n  scale0: 1000000000u128,\n  scale1: 1u128\n}'

/** Scripted client: answers the `pools` mapping read getPool performs. */
function fakeClient(): Client {
  return {
    account: { type: 'local', address: 'aleo1me' },
    request: async (req: { method: string; params?: { mapping?: string } }) => {
      if (req.method === 'getMappingValue') return req.params?.mapping === 'pools' ? POOL_PLAINTEXT : null
      throw new Error(`unexpected ${req.method}`)
    },
  } as unknown as Client
}

/** Fake API recording the args it receives. */
function fakeApi(calls: Record<string, unknown>): ApiClient {
  return {
    getPools: async (q: unknown) => ((calls.getPools = q), { data: [] }),
    getRoute: async (q: unknown) => ((calls.getRoute = q), { data: { amount_out: '0' } }),
    getTokens: async () => ({ data: [] }),
    getPublicBalances: async (q: unknown) => ((calls.getPublicBalances = q), { data: [] }),
  } as unknown as ApiClient
}

describe('shieldSwapAgentToolSchemas — gating', () => {
  const names = (cfg?: Parameters<typeof shieldSwapAgentToolSchemas>[0]) =>
    shieldSwapAgentToolSchemas(cfg).map((s) => s.name)

  it('returns everything with no config', () => {
    const all = names()
    expect(all).toContain('shield_swap_get_pool') // chain
    expect(all).toContain('shield_swap_list_pools') // api
    expect(all).toContain('shield_swap_get_balances') // composed
  })

  it('gates by which backing is present', () => {
    expect(names({ client: {} as Client })).toContain('shield_swap_get_pool')
    expect(names({ client: {} as Client })).not.toContain('shield_swap_list_pools')

    expect(names({ api: {} as ApiClient })).toContain('shield_swap_list_pools')
    expect(names({ api: {} as ApiClient })).not.toContain('shield_swap_get_pool')

    // composed tool needs BOTH
    expect(names({ client: {} as Client })).not.toContain('shield_swap_get_balances')
    expect(names({ client: {} as Client, api: {} as ApiClient })).toContain('shield_swap_get_balances')
  })

  it('gates money-moving write tools behind includeWrites', () => {
    // Off by default, even with a client.
    expect(names({ client: {} as Client })).not.toContain('shield_swap_swap')
    // Opt-in requires a client too.
    expect(names({ includeWrites: true })).not.toContain('shield_swap_swap')
    // Client + opt-in → writes appear.
    const withWrites = names({ client: {} as Client, includeWrites: true })
    expect(withWrites).toEqual(expect.arrayContaining(['shield_swap_swap', 'shield_swap_claim', 'shield_swap_create_pool']))
    // No config returns everything, writes included.
    expect(names()).toContain('shield_swap_mint')
  })
})

describe('createShieldSwapAgentTools — wiring', () => {
  it('every tool has a matching handler and schema, names unique', () => {
    const tools = createShieldSwapAgentTools({ client: fakeClient(), api: fakeApi({}) })
    const names = tools.map((t) => t.schema.name)
    expect(new Set(names).size).toBe(names.length)
    for (const t of tools) expect(typeof t.handler).toBe('function')
  })

  it('get_pool handler decodes and renders bigints as strings (JSON-safe)', async () => {
    const tools = createShieldSwapAgentTools({ client: fakeClient() })
    const getPool = tools.find((t) => t.schema.name === 'shield_swap_get_pool')!
    const result = (await getPool.handler({ poolKey: '4719field' })) as Record<string, unknown>
    expect(result.token0).toBe('122352848155208110005843045field')
    expect(result.scale0).toBe('1000000000') // bigint → string
    expect(typeof result.scale0).toBe('string')
  })

  it('get_route handler coerces the string amount to a bigint for the API', async () => {
    const calls: Record<string, unknown> = {}
    const tools = createShieldSwapAgentTools({ client: fakeClient(), api: fakeApi(calls) })
    const getRoute = tools.find((t) => t.schema.name === 'shield_swap_get_route')!
    await getRoute.handler({ tokenIn: 'aField', tokenOut: 'bField', amountIn: '1000000000000000000' })
    expect(calls.getRoute).toEqual({ token_in: 'aField', token_out: 'bField', amount_in: 10n ** 18n })
  })
})
