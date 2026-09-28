import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, executeContract, writeContract } from '@provablehq/veil-core'
import { shieldSwapActions } from '../../../src/decorators/shieldSwapActions.js'
import { ApiClient } from '../../../src/api/client.js'
import { programToTokenId, clearRouteCache } from '../../../src/utils/routing.js'
import { createShieldSwapAgentTools } from '../../../src/agent/index.js'
import { swap } from '../../../src/actions/swap/swap.js'

vi.mock('@provablehq/veil-core', async (original) => ({
  ...await original<typeof import('@provablehq/veil-core')>(),
  executeContract: vi.fn(), writeContract: vi.fn(),
}))

const tokens = ['usdc', 'aleo', 'eth', 'btc'].map((name) => ({
  address: programToTokenId(name), symbol: name.toUpperCase(), decimals: name === 'btc' ? 8 : 6,
}))
const slot = '{ tick: 0i32, tick_spacing: 60u32, sqrt_price: { hi: 1u128, lo: 0u128 }, fee_protocol: 0u8, liquidity: 1000000u128, fee_growth_global0_x_128: { hi: 0u128, lo: 0u128 }, fee_growth_global1_x_128: { hi: 0u128, lo: 0u128 }, max_liquidity_per_tick: 1u128, protocol_fees0: 0u128, protocol_fees1: 0u128, next_init_below: -60i32, next_init_above: 60i32 }'
function setup(count = 1, accountType: 'local' | 'rpc' = 'local') {
  const hops = Array.from({ length: count }, (_, i) => ({ pool_key: `${i + 1}field`, token_in: tokens[i]!.address, token_out: tokens[i + 1]!.address, zero_for_one: true, fee: '30', active_tick: 0, sqrt_price_raw: (1n << 128n).toString(), liquidity: '1000000', initialized_ticks: [-20000, 20000] }))
  const route = { token_in: tokens[0]!.address, token_out: tokens[count]!.address, hops, estimated_amount_out: (count === 3 ? '1.23456789' : '1.234567') as string | null, protocol_revision: 3, protocol_config_observed_block: 42 }
  let paused = false
  let noLiquidity = false
  const request = vi.fn(async ({ method, params }: any) => {
    if (method === 'getLatestHeight' || method === 'getBlockNumber') return 1000n
    if (method === 'getProgram') return `program ${params.programId};\n`
    if (params.mapping === 'slots') return noLiquidity ? slot.replace('1000000u128', '0u128') : slot
    if (params.mapping === 'pools') {
      const i = Number(params.key.replace('field', '')) - 1
      return `{ token0: ${tokens[i]!.address}, token1: ${tokens[i + 1]!.address}, fee: 30u16, enabled: ${!paused} }`
    }
    return null
  })
  const api = new ApiClient({ baseUrl: 'https://example.invalid' })
  vi.spyOn(api, 'getTokens').mockResolvedValue({ data: tokens } as any)
  const routeCall = vi.spyOn(api, 'getRoute').mockImplementation(async () => ({ data: route }) as any)
  const client = createClient({
    transport: { config: { type: 'test', key: 'test', name: 'test', network: 'testnet', request }, request },
    account: { type: accountType, address: 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px', viewKey: 'unused' } as any,
  }).extend(shieldSwapActions({ api }))
  const params = { from: 'USDC', to: tokens[count]!.symbol, amountIn: 500_000n, slippageBps: 125 }
  return { client, params, route, request, routeCall, pause: () => { paused = true }, drain: () => { noLiquidity = true } }
}
const execution = { tokenRecord: '{ owner: aleo1me.private, amount: 5000000u128.private, _nonce: 1group.public }', blindedIdentity: { blindingFactor: '111field', blindedAddress: 'aleo1t08epjqqv8h7jpuy2m2cxm80zy2pcy5c4f3m82hnac4sjmdrjyysvx3s2h' }, nonce: 42n }

describe('quote decimal inputs', () => {
  it('converts a decimal string using the resolved input token decimals', async () => {
    const { client, params, routeCall } = setup()
    const offer = await client.quote({ ...params, amountIn: '1.5' })
    expect(offer.amountIn).toBe(1_500_000n)
    expect(routeCall).toHaveBeenCalledWith(expect.objectContaining({ amount_in: '1.5' }))
  })

  it('keeps bigint inputs in raw units', async () => {
    const { client, params } = setup()
    expect((await client.quote({ ...params, amountIn: 1n })).amountIn).toBe(1n)
    expect((await client.quote({ ...params, amountIn: '1' })).amountIn).toBe(1_000_000n)
  })

  it.each(['0', '-1', '1.0000001', '1e6', 'NaN'])('rejects invalid or over-precise decimal input %s before routing', async (amountIn) => {
    const { client, params, routeCall } = setup()
    await expect(client.quote({ ...params, amountIn })).rejects.toThrow()
    expect(routeCall).not.toHaveBeenCalled()
  })
})
beforeEach(() => {
  vi.restoreAllMocks()
  clearRouteCache()
  vi.mocked(executeContract).mockReset().mockResolvedValue({ transactionId: 'at1tx', transitions: [], outputs: ['777field'] } as any)
  vi.mocked(writeContract).mockReset().mockResolvedValue('at1wallet')
})

describe('quote → swap', () => {
  it.each([1, 2, 3])('quotes and executes %i hops with the exact final minimum', async (count) => {
    const { client, params, routeCall, request } = setup(count)
    const quote = await client.quote(params)
    expect(routeCall).toHaveBeenCalledWith({ token_in: tokens[0]!.address, token_out: tokens[count]!.address, amount_in: '0.5' })
    expect(quote.expectedOut).toBe(count === 3 ? 123456789n : 1234567n)
    expect(quote.minOut).toBe(count === 3 ? 121913579n : 1219134n)
    expect(quote.hops).toHaveLength(count)
    expect(quote.protocolRevision).toBe(3)
    expect(request).not.toHaveBeenCalled()
    const handle = await client.swap({ quote, ...execution })
    if ('amountOutMin' in handle) expect(handle.amountOutMin).toBe(quote.minOut)
    expect(handle.tokenOutId).toBe(tokens[count]!.address)
    const call = vi.mocked(executeContract).mock.calls[0]![1]
    expect(call.function).toBe(count === 1 ? 'swap' : 'swap_multi_hop')
    expect(call.inputs).toContain(`${quote.minOut}u128`)
    expect(call.imports).toHaveProperty('aleo.aleo')
  })
  it('supports wallet submission and standalone execution', async () => {
    const { client, params } = setup(2, 'rpc')
    const quote = await client.quote(params)
    const handle = await swap(client, { quote, ...execution, tokenRecord: { kind: 'record', program: 'usdc.aleo', record: 'Token', minAmount: 500000n } as any })
    expect(handle.amountOutMin).toBe(1219134n)
    expect(writeContract).toHaveBeenCalledOnce()
  })
  it.each([null, '0', '-1', 'not-a-number'])('rejects unusable API estimates (%s)', async (estimate) => {
    const s = setup(); s.route.estimated_amount_out = estimate
    await expect(s.client.quote(s.params)).rejects.toThrow(/estimate|output|decimal/i)
  })
  it.each([0n, -1n, 1n << 128n])('rejects invalid input amount %s', async (amountIn) => {
    const s = setup()
    await expect(s.client.quote({ ...s.params, amountIn })).rejects.toThrow(/amountIn/)
    expect(s.routeCall).not.toHaveBeenCalled()
  })
  it('rejects disconnected routes and routes inconsistent with chain pools', async () => {
    const s = setup(2); s.route.hops[1]!.token_in = tokens[0]!.address
    await expect(s.client.quote(s.params)).rejects.toThrow(/route|hop/i)
    s.route.hops[1]!.token_in = tokens[1]!.address
    s.route.hops[0]!.pool_key = '3field'
    const quote = await s.client.quote(s.params)
    await expect(s.client.swap({ quote, ...execution })).rejects.toThrow(/route|hop/i)
  })
  it('rechecks tradeability and liquidity before spending', async () => {
    const s = setup(); const quote = await s.client.quote(s.params); s.pause()
    await expect(s.client.swap({ quote, ...execution })).rejects.toThrow(/paused|tradeable/i)
    const d = setup(); const q = await d.client.quote(d.params); d.drain()
    await expect(d.client.swap({ quote: q, ...execution })).rejects.toThrow(/liquidity/i)
    expect(executeContract).not.toHaveBeenCalled()
  })
  it('rejects expired, modified, conflicting, and wrong-network quotes before spending', async () => {
    const s = setup(); const quote = await s.client.quote(s.params)
    for (const [q, error] of [
      [{ ...quote, quotedAt: Date.now() - 120000, expiresAt: Date.now() - 60000 }, /expired/i],
      [{ ...quote, network: 'mainnet' }, /network/i],
      [{ ...quote, minOut: 1n }, /minimum|floor/i],
    ] as const) await expect(s.client.swap({ quote: q, ...execution })).rejects.toThrow(error)
    await expect(s.client.swap({ quote, ...execution, amountIn: 1n } as any)).rejects.toThrow(/override|conflict/i)
    expect(executeContract).not.toHaveBeenCalled()
  })
  it('round-trips quote amounts through agent JSON and keeps writes opt-in', async () => {
    const s = setup(2)
    const readTools = createShieldSwapAgentTools({ client: s.client, api: s.client.api })
    expect(readTools.some((t) => t.schema.name === 'shield_swap_swap')).toBe(false)
    const tool = readTools.find((t) => t.schema.name === 'shield_swap_quote')!
    expect(tool).toBeDefined()
    const offer = await tool.handler({ ...s.params, amountIn: '0.5' }) as any
    expect(offer.amountIn).toBe('500000')
    expect(JSON.parse(JSON.stringify(offer)).minOut).toBe('1219134')
    const write = createShieldSwapAgentTools({ client: s.client, includeWrites: true }).find((t) => t.schema.name === 'shield_swap_swap')!
    const expired = { ...offer, quotedAt: Date.now() - 120000, expiresAt: Date.now() - 60000 }
    await expect(write.handler({ quote: expired })).rejects.toThrow(/expired/i)
    await expect(write.handler({ quote: offer, amountIn: '2' })).rejects.toThrow(/override|conflict/i)
    expect(executeContract).not.toHaveBeenCalled()
  })

  it('rejects fractional slippage, zero floors, overlong and repeated routes', async () => {
    const s = setup()
    await expect(s.client.quote({ ...s.params, slippageBps: 0.5 })).rejects.toThrow(/slippage/)
    await expect(s.client.quote({ ...s.params, slippageBps: 10000 })).rejects.toThrow(/minimum/)
    s.route.hops.push(s.route.hops[0]!)
    await expect(s.client.quote(s.params)).rejects.toThrow(/route/i)
    s.route.hops.push(s.route.hops[0]!, s.route.hops[0]!)
    await expect(s.client.quote(s.params)).rejects.toThrow(/route/i)
  })
  it('rejects a quote that expires during execution preparation', async () => {
    const s = setup()
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const quote = await s.client.quote(s.params)
    const request = s.request.getMockImplementation()!
    s.request.mockImplementation(async (req) => {
      vi.mocked(Date.now).mockReturnValue(now + 60000)
      return request(req)
    })
    await expect(s.client.swap({ quote, ...execution })).rejects.toThrow(/expired/i)
    expect(executeContract).not.toHaveBeenCalled()
  })
  it('binds configured programs and checks only pools in the accepted route', async () => {
    const s = setup(2)
    const client = s.client.extend(shieldSwapActions({ api: s.client.api, program: 'other.aleo' }))
    const offer = await client.quote(s.params)
    expect(offer.program).toBe('other.aleo')
    await client.swap({ quote: offer, ...execution })
    const poolReads = s.request.mock.calls.map(([r]) => r).filter((r) => r.params?.mapping === 'pools')
    expect(new Set(poolReads.map((r) => r.params.key))).toEqual(new Set(['1field', '2field']))
    expect(poolReads.every((r) => r.params.programId === 'other.aleo')).toBe(true)
    await expect(client.swap({ quote: { ...offer, program: 'shield_swap.aleo' }, ...execution })).rejects.toThrow(/program/i)
  })

  it.each([[1, 'local'], [1, 'rpc'], [2, 'local'], [2, 'rpc']] as const)(
    'rejects expiry during the final preparation of %i hops for %s signing', async (count, signer) => {
      const s = setup(count, signer)
      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now)
      const quote = await s.client.quote(s.params)
      const request = s.request.getMockImplementation()!
      s.request.mockImplementation(async (req) => {
        if (req.method === 'getLatestHeight' || req.method === 'getBlockNumber') vi.mocked(Date.now).mockReturnValue(now + 60000)
        return request(req)
      })
      await expect(s.client.swap({ quote, ...execution })).rejects.toThrow(/expired/i)
      expect(executeContract).not.toHaveBeenCalled()
      expect(writeContract).not.toHaveBeenCalled()
    },
  )

})
