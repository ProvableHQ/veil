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
    expect(withWrites).toEqual(
      expect.arrayContaining([
        'shield_swap_swap',
        'shield_swap_claim',
        'shield_swap_create_pool',
        'shield_swap_swap_multi_hop',
        'shield_swap_claim_multi_hop',
      ]),
    )
    // No config returns everything, writes included.
    expect(names()).toContain('shield_swap_mint')
  })

  it('includes the new chain reads with a client', () => {
    const chain = names({ client: {} as Client })
    expect(chain).toEqual(
      expect.arrayContaining(['shield_swap_get_position', 'shield_swap_get_tick', 'shield_swap_get_trade_controls']),
    )
  })

  it('always includes the pure derivation tools — no backing needed', () => {
    for (const cfg of [undefined, { client: {} as Client }, { api: {} as ApiClient }, {}]) {
      expect(names(cfg)).toEqual(
        expect.arrayContaining([
          'shield_swap_derive_swap_id',
          'shield_swap_derive_position_token_id',
          'shield_swap_derive_multi_hop_swap_id',
        ]),
      )
    }
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

  it('derive_position_token_id handler round-trips against derivePositionTokenId', async () => {
    const { derivePositionTokenId } = await import('../../src/utils/keys.js')
    const tools = createShieldSwapAgentTools({})
    const tool = tools.find((t) => t.schema.name === 'shield_swap_derive_position_token_id')!
    const blinded = 'aleo1t08epjqqv8h7jpuy2m2cxm80zy2pcy5c4f3m82hnac4sjmdrjyysvx3s2h'
    const result = (await tool.handler({
      poolKey: '1field',
      tickLower: -600,
      tickUpper: 600,
      amount0Desired: '10',
      amount1Desired: '10',
      tickLowerHint: -600,
      tickUpperHint: -600,
      recipient: blinded,
      nonce: '7field',
    })) as { positionTokenId: string }
    expect(result.positionTokenId).toBe(
      await derivePositionTokenId({
        request: {
          pool: '1field',
          tickLower: -600,
          tickUpper: 600,
          amount0Desired: 10n,
          amount1Desired: 10n,
          amount0Min: 0n, // schema default when omitted
          amount1Min: 0n,
          tickLowerHint: -600,
          tickUpperHint: -600,
        },
        recipient: blinded,
        nonce: '7field',
      }),
    )
  })

  it('derive_multi_hop_swap_id handler round-trips against deriveMultiHopSwapId', async () => {
    const { deriveMultiHopSwapId } = await import('../../src/utils/keys.js')
    const tools = createShieldSwapAgentTools({})
    const tool = tools.find((t) => t.schema.name === 'shield_swap_derive_multi_hop_swap_id')!
    const blinded = 'aleo1t08epjqqv8h7jpuy2m2cxm80zy2pcy5c4f3m82hnac4sjmdrjyysvx3s2h'
    const hops = [
      { poolKey: '10field', zeroForOne: true, sqrtPriceLimit: '19029805711' },
      { poolKey: '20field', zeroForOne: false, sqrtPriceLimit: '4470386772317930780047134862' },
    ]
    const result = (await tool.handler({
      tokenInId: '1field',
      tokenOutId: '2field',
      amountIn: '1000',
      amountOutMin: '1',
      blindedAddress: blinded,
      hops,
      nonce: '42',
      deadline: 5000000,
    })) as { swapId: string }
    expect(result.swapId).toBe(
      await deriveMultiHopSwapId({
        tokenInId: '1field',
        tokenOutId: '2field',
        amountIn: 1000n,
        amountOutMin: 1n,
        blindedAddress: blinded,
        hops: hops.map((h) => ({ ...h, sqrtPriceLimit: BigInt(h.sqrtPriceLimit) })),
        nonce: 42n,
        deadline: 5000000,
      }),
    )
  })

  it('derive_swap_id handler round-trips against deriveSwapId', async () => {
    const { deriveSwapId } = await import('../../src/utils/keys.js')
    const tools = createShieldSwapAgentTools({})
    const tool = tools.find((t) => t.schema.name === 'shield_swap_derive_swap_id')!
    const blinded = 'aleo1t08epjqqv8h7jpuy2m2cxm80zy2pcy5c4f3m82hnac4sjmdrjyysvx3s2h'
    const result = (await tool.handler({
      poolKey: '1field',
      zeroForOne: true,
      amountIn: '1000',
      sqrtPriceLimit: '19029805711',
      blindedAddress: blinded,
      nonce: '42',
    })) as { swapId: string }
    expect(result.swapId).toBe(
      await deriveSwapId({
        poolKey: '1field',
        zeroForOne: true,
        amountIn: 1000n,
        sqrtPriceLimit: 19029805711n,
        blindedAddress: blinded,
        nonce: 42n,
      }),
    )
  })
})
