import { describe, expect, it } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { ApiClient } from '../../src/api/client.js'
import { createShieldSwapAgentTools, shieldSwapAgentToolSchemas } from '../../src/agent/index.js'
import { createShieldSwapMcpServer } from '../../src/mcp/index.js'

type RequestCase = {
  name: string
  input?: Record<string, unknown>
  path: string
  query?: Record<string, string>
  method?: string
  body?: unknown
}

// Literal endpoint contracts catch missing tools, wrong routes, and casing/unit conversions.
const cases: RequestCase[] = [
  { name: 'get_api_pool', input: { poolKey: '1field' }, path: '/pools/1field' },
  { name: 'get_pool_stats', input: { poolKey: '1field' }, path: '/pools/1field/stats' },
  { name: 'get_pool_trades', input: { poolKey: '1field', limit: 4, offset: 2, tradeType: 'add_liquidity' }, path: '/pools/1field/trades', query: { limit: '4', offset: '2', trade_type: 'add_liquidity' } },
  { name: 'get_pool_ohlcv', input: { poolKey: '1field', granularity: '30m', from: 100, to: 200, summaryFrom: 120, orientation: 'display' }, path: '/pools/1field/ohlcv', query: { granularity: '30m', from: '100', to: '200', summary_from: '120', orientation: 'display' } },
  { name: 'get_api_positions', input: { limit: 8, offset: 4 }, path: '/positions', query: { limit: '8', offset: '4' } },
  { name: 'get_fee_tiers', path: '/fee-tiers' },
  { name: 'get_initialized_ticks', input: { poolKey: '1field' }, path: '/pools/1field/initialized-ticks' },
  { name: 'get_airdrop_status', input: { jobId: 'job/1' }, path: '/airdrop/job%2F1' },
  { name: 'debug_pool', input: { poolKey: '1field', ticks: '-60,60' }, path: '/debug/pool', query: { pool_key: '1field', ticks: '-60,60' } },
  { name: 'get_websocket_ticket', path: '/auth/ws-ticket' },
  { name: 'get_my_referral_code', path: '/referral/my-code' },
  { name: 'get_compliance_config', path: '/compliance' },
  { name: 'get_token_compliance', input: { tokenId: '1field' }, path: '/compliance/tokens/1field' },
  { name: 'get_pair_compliance', input: { token0: '1field', token1: '2field' }, path: '/compliance/pairs/1field/2field' },
  { name: 'get_explore_pools', input: { window: '1d', sort: 'volume', order: 'desc', limit: 8, offset: 2, search: 'USDC' }, path: '/explore/pools', query: { window: '1d', sort: 'volume', order: 'desc', limit: '8', offset: '2', search: 'USDC' } },
  { name: 'get_explore_tokens', input: { window: '1w', sort: 'price', order: 'asc', limit: 4, offset: 1, search: 'ETH' }, path: '/explore/tokens', query: { window: '1w', sort: 'price', order: 'asc', limit: '4', offset: '1', search: 'ETH' } },
  { name: 'get_explore_token', input: { tokenId: '2field', window: '1h' }, path: '/explore/tokens/2field', query: { window: '1h' } },
  { name: 'get_explore_transactions', input: { window: '1m', type: 'mint', token: 'ETH', pool: '1field', cursor: 'next', limit: 3 }, path: '/explore/transactions', query: { window: '1m', type: 'mint', token: 'ETH', pool: '1field', cursor: 'next', limit: '3' } },
  { name: 'get_geckoterminal_asset', input: { id: '1field' }, path: '/geckoterminal/asset', query: { id: '1field' } },
  { name: 'get_geckoterminal_pair', input: { id: '2field' }, path: '/geckoterminal/pair', query: { id: '2field' } },
  { name: 'get_geckoterminal_events', input: { fromBlock: 100, toBlock: 200 }, path: '/geckoterminal/events', query: { fromBlock: '100', toBlock: '200' } },
  { name: 'get_geckoterminal_latest_block', path: '/geckoterminal/latest-block' },
  { name: 'get_pool_stats_batch', input: { keys: '1field,2field' }, path: '/pools/stats', query: { keys: '1field,2field' } },
  { name: 'get_pool_liquidity_distribution', input: { poolKey: '1field' }, path: '/pools/1field/liquidity-distribution' },
  { name: 'get_pool_oracle', input: { poolKey: '1field', windowSeconds: 300 }, path: '/pools/1field/oracle', query: { window_seconds: '300' } },
  { name: 'get_rebalance_state', input: { poolKey: '1field', tickLower: -60, tickUpper: 60, oldLiquidity: '340282366920938463463374607431768211', mintTickLower: -120, mintTickUpper: 120 }, path: '/pools/1field/rebalance-state', query: { tick_lower: '-60', tick_upper: '60', old_liquidity: '340282366920938463463374607431768211', mint_tick_lower: '-120', mint_tick_upper: '120' } },
  { name: 'get_protocol_state', input: { minimumRevision: 3 }, path: '/protocol/state', query: { minimum_revision: '3' } },
  { name: 'record_referral_activity', input: { action: 'create_pool', txId: 'at1tx', metadata: { pool: '1field' } }, path: '/referral/activity', method: 'POST', body: { action: 'create_pool', tx_id: 'at1tx', metadata: { pool: '1field' } } },
  { name: 'record_referral_address_batch', input: { code: 'CODE', blindedAddresses: ['aleo1blind'] }, path: '/referral/address-batches', method: 'POST', body: { code: 'CODE', blinded_addresses: ['aleo1blind'] } },
  { name: 'get_referral_admin_status', path: '/referral/admin' },
  { name: 'record_referral_swap_claim', input: { code: 'CODE', blindedAddress: 'aleo1blind' }, path: '/referral/swap-claims', method: 'POST', body: { code: 'CODE', blinded_address: 'aleo1blind' } },
  { name: 'get_route_topology', path: '/route/topology' },
  { name: 'get_unclaimed', path: '/unclaimed' },
  { name: 'get_usdc_usd_history', input: { from: 100, to: 200 }, path: '/prices/usdc-usd/history', query: { from: '100', to: '200' } },
  { name: 'get_auth_challenge', input: { address: 'aleo1caller' }, path: '/auth/challenge', method: 'POST', body: { address: 'aleo1caller' } },
  { name: 'verify_auth_challenge', input: { address: 'aleo1caller', signature: 'sign1signature', challengeId: 'challenge1' }, path: '/auth/verify', method: 'POST', body: { address: 'aleo1caller', signature: 'sign1signature', challenge_id: 'challenge1' } },
  { name: 'get_session', path: '/auth/session' },
  { name: 'refresh_session', path: '/auth/refresh', method: 'POST' },
  { name: 'logout', path: '/auth/logout', method: 'POST' },
  { name: 'logout_all', path: '/auth/logout-all', method: 'POST' },
  { name: 'list_sessions', path: '/auth/sessions' },
  { name: 'revoke_session', input: { sessionId: 'session/1' }, path: '/auth/sessions/session%2F1/revoke', method: 'POST' },
]

const sessionMetadata = { address: 'aleo1caller', session_id: 'session1', session_version: 1, expires_at: 200, server_time: 100 }
const sessionTools = ['get_session', 'refresh_session', 'verify_auth_challenge']
const unwrappedTools = ['get_airdrop_status', 'get_websocket_ticket', 'get_my_referral_code', 'record_referral_activity', 'record_referral_address_batch', 'get_referral_admin_status', 'record_referral_swap_claim', 'get_auth_challenge', 'logout', 'logout_all', 'list_sessions', 'revoke_session']

function harness(response: unknown = { data: { observed: true } }) {
  const requests: Array<{ url: URL; method: string; body: unknown; headers: Headers }> = []
  const api = new ApiClient({
    baseUrl: 'https://api.example.test',
    apiToken: 'ss_api',
    credentials: 'include',
    fetch: async (url, init) => {
      requests.push({ url: new URL(String(url)), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) })
      return new Response(JSON.stringify(response), { status: 200, headers: { 'set-cookie': 'ss_access=session-secret; HttpOnly' } })
    },
  })
  api.setToken('session-secret')
  return { api, requests }
}

describe('non-admin DEX API agent tools', () => {
  it.each(cases)('$name maps agent inputs to its HTTP endpoint', async ({ name, input = {}, path, query = {}, method = 'GET', body }) => {
    const response = sessionTools.includes(name) ? { data: { ...sessionMetadata, csrf_token: 'csrf-secret' } } : { data: { observed: true } }
    const { api, requests } = harness(response)
    const tool = createShieldSwapAgentTools({ api }).find((t) => t.schema.name === `shield_swap_${name}`)
    expect(tool, `Missing API-only tool shield_swap_${name}`).toBeDefined()
    const expected = sessionTools.includes(name) ? sessionMetadata : unwrappedTools.includes(name) ? response.data : response
    expect(await tool!.handler(input)).toEqual(expected)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url.pathname).toBe(path)
    expect(Object.fromEntries(requests[0]!.url.searchParams)).toEqual(query)
    expect(requests[0]!.method).toBe(method)
    expect(requests[0]!.body).toEqual(body)
  })

  it('gates the faucet on api plus includeWrites and submits a server-funded transfer', async () => {
    const { api, requests } = harness({ data: { job_id: 'job1', status: 'running' } })
    const names = (config: Parameters<typeof shieldSwapAgentToolSchemas>[0]) => shieldSwapAgentToolSchemas(config).map((s) => s.name)
    expect(names({ api })).not.toContain('shield_swap_airdrop')
    expect(names({ includeWrites: true, client: {} as Client })).not.toContain('shield_swap_airdrop')
    expect(names({ api, includeWrites: true })).toContain('shield_swap_airdrop')
    expect(names(undefined)).toContain('shield_swap_airdrop')
    const tool = createShieldSwapAgentTools({ api, includeWrites: true }).find((t) => t.schema.name === 'shield_swap_airdrop')
    expect(tool).toBeDefined()
    expect(await tool!.handler({ address: 'aleo1recipient' })).toEqual({ job_id: 'job1', status: 'running' })
    expect(requests[0]!.method).toBe('POST')
    expect(requests[0]!.url.pathname).toBe('/airdrop')
    expect(requests[0]!.body).toEqual({ address: 'aleo1recipient' })
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer session-secret')
  })

  it.each(['get_session', 'refresh_session', 'verify_auth_challenge'])('%s does not expose session credentials', async (name) => {
    const metadata = { address: 'aleo1caller', session_id: 'session1', session_version: 1, expires_at: 200, server_time: 100 }
    const { api } = harness({ data: { ...metadata, csrf_token: 'csrf-secret', token: 'legacy-secret', access_token: 'access-secret', refresh_token: 'refresh-secret' } })
    const tool = createShieldSwapAgentTools({ api }).find((t) => t.schema.name === `shield_swap_${name}`)
    expect(tool).toBeDefined()
    const result = await tool!.handler({ address: 'aleo1caller', signature: 'sign1signature', challengeId: 'challenge1' })
    expect(result).toEqual(metadata)
  })

  it('returns a WebSocket ticket explicitly requested for a connection', async () => {
    const ticket = { token: 'ws-ticket', expires_at: 120, server_time: 100 }
    const { api } = harness({ data: ticket })
    const tool = createShieldSwapAgentTools({ api }).find((t) => t.schema.name === 'shield_swap_get_websocket_ticket')
    expect(tool).toBeDefined()
    expect(await tool!.handler({})).toEqual(ticket)
  })

  it('passes pool valuation and pinned decimal route inputs through existing tools', async () => {
    const { api, requests } = harness()
    const tools = createShieldSwapAgentTools({ api })
    await tools.find((t) => t.schema.name === 'shield_swap_list_pools')!.handler({ includeValuation: false })
    await tools.find((t) => t.schema.name === 'shield_swap_get_route')!.handler({ tokenIn: '1field', tokenOut: '2field', amountIn: '0.5', poolKey: '3field' })
    expect(Object.fromEntries(requests[0]!.url.searchParams)).toEqual({ include_valuation: 'false' })
    expect(Object.fromEntries(requests[1]!.url.searchParams)).toEqual({ token_in: '1field', token_out: '2field', amount_in: '0.5', pool_key: '3field' })
  })

  it('requires API backing for all new tools and excludes admin operations', () => {
    const { api } = harness()
    const apiTools = shieldSwapAgentToolSchemas({ api }).map((s) => s.name)
    const noApi = shieldSwapAgentToolSchemas({ client: {} as Client, includeWrites: true }).map((s) => s.name)
    for (const { name } of cases) {
      expect(apiTools).toContain(`shield_swap_${name}`)
      expect(noApi).not.toContain(`shield_swap_${name}`)
    }
    const all = shieldSwapAgentToolSchemas().map((s) => s.name)
    expect(new Set(all).size).toBe(all.length)
    for (const name of ['admin_revoke_sessions', 'get_referral_admin_volume', 'list_referral_codes', 'generate_referral_codes', 'get_referral_settings', 'update_referral_settings']) {
      expect(all).not.toContain(`shield_swap_${name}`)
    }
  })

  it('forwards a new API tool through MCP with server results intact', async () => {
    const response = { data: { pools: [{ key: '1field' }] } }
    const { api, requests } = harness(response)
    const server = createShieldSwapMcpServer({ api })
    expect(server.tools.map((t) => t.name)).toContain('shield_swap_get_route_topology')
    expect(await server.handleToolCall('shield_swap_get_route_topology', {})).toEqual(response)
    expect(requests[0]!.url.pathname).toBe('/route/topology')
  })
})
