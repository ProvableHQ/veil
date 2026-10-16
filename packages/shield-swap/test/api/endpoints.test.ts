import { describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiError } from '../../src/api/client.js'

const origin = 'https://api.example.test'

function fixture(response: unknown, options: { apiToken?: string; session?: string; status?: number } = {}) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(response), { status: options.status ?? 200 }))
  const api = new ApiClient({ baseUrl: origin, fetch, apiToken: options.apiToken })
  if (options.session) api.setToken(options.session)
  return { api, fetch }
}

function expectRequest(fetch: ReturnType<typeof fixture>['fetch'], path: string, options: {
  query?: Record<string, string>
  auth?: string
  body?: unknown
} = {}) {
  expect(fetch).toHaveBeenCalledTimes(1)
  const [input, init] = fetch.mock.calls[0]! as unknown as [URL, RequestInit]
  const url = new URL(input)
  expect(url.origin).toBe(origin)
  expect(url.pathname).toBe(path)
  expect(Object.fromEntries(url.searchParams)).toEqual(options.query ?? {})
  expect(init.method).toBe(options.body === undefined ? 'GET' : 'POST')
  expect(init.headers).toEqual({
    accept: 'application/json',
    ...(options.auth ? { authorization: `Bearer ${options.auth}` } : {}),
    ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
  })
  expect(init.body).toBe(options.body === undefined ? undefined : JSON.stringify(options.body))
}

describe('public API endpoint contracts', () => {
  const cases: Array<{
    name: string
    call: (api: ApiClient) => Promise<unknown>
    path: string
    query?: Record<string, string>
    response?: unknown
  }> = [
    { name: 'global compliance', call: api => api.getComplianceConfig(), path: '/compliance' },
    { name: 'token compliance', call: api => api.getTokenCompliance('token/id'), path: '/compliance/tokens/token%2Fid' },
    { name: 'pair compliance', call: api => api.getPairCompliance('token/0', 'token?1'), path: '/compliance/pairs/token%2F0/token%3F1' },
    {
      name: 'explore pools', call: api => api.getExplorePools({ window: '1w', sort: 'tvl', order: 'asc', limit: 12, offset: 0, search: 'A B' }),
      path: '/explore/pools', query: { window: '1w', sort: 'tvl', order: 'asc', limit: '12', offset: '0', search: 'A B' },
    },
    {
      name: 'explore tokens', call: api => api.getExploreTokens({ window: '1h', sort: 'volume', order: 'desc', limit: 5, offset: 2, search: 'USDC' }),
      path: '/explore/tokens', query: { window: '1h', sort: 'volume', order: 'desc', limit: '5', offset: '2', search: 'USDC' },
    },
    { name: 'explore token detail', call: api => api.getExploreToken('token/id', { window: '1m' }), path: '/explore/tokens/token%2Fid', query: { window: '1m' } },
    {
      name: 'explore transaction feed', call: api => api.getExploreTransactions({ window: '1d', type: 'swap', token: 'A B', pool: '1field', cursor: 'next/=?', limit: 8 }),
      path: '/explore/transactions', query: { window: '1d', type: 'swap', token: 'A B', pool: '1field', cursor: 'next/=?', limit: '8' },
    },
    { name: 'GeckoTerminal asset', call: api => api.getGeckoTerminalAsset('token/id'), path: '/geckoterminal/asset', query: { id: 'token/id' }, response: { asset: { id: 'token/id' } } },
    { name: 'GeckoTerminal pair', call: api => api.getGeckoTerminalPair('pool/id'), path: '/geckoterminal/pair', query: { id: 'pool/id' }, response: { pair: { id: 'pool/id' } } },
    { name: 'GeckoTerminal events', call: api => api.getGeckoTerminalEvents({ fromBlock: 0, toBlock: 123 }), path: '/geckoterminal/events', query: { fromBlock: '0', toBlock: '123' }, response: { events: [] } },
    { name: 'GeckoTerminal checkpoint', call: api => api.getGeckoTerminalLatestBlock(), path: '/geckoterminal/latest-block', response: { block: { blockNumber: 123 } } },
    { name: 'batch pool stats', call: api => api.getPoolStatsBatch({ keys: '1field,2field' }), path: '/pools/stats', query: { keys: '1field,2field' } },
    { name: 'pool liquidity distribution', call: api => api.getPoolLiquidityDistribution('pool/key'), path: '/pools/pool%2Fkey/liquidity-distribution' },
    { name: 'pool oracle', call: api => api.getPoolOracle('pool/key', { window_seconds: 3600 }), path: '/pools/pool%2Fkey/oracle', query: { window_seconds: '3600' } },
    { name: 'protocol revision floor', call: api => api.getProtocolState({ minimum_revision: 42 }), path: '/protocol/state', query: { minimum_revision: '42' }, response: { revision: 42 } },
    { name: 'USDC/USD history', call: api => api.getUsdcUsdHistory({ from: 100, to: 3700 }), path: '/prices/usdc-usd/history', query: { from: '100', to: '3700' } },
    { name: 'pool valuation false', call: api => api.getPools({ include_valuation: false, limit: 2, offset: undefined }), path: '/pools', query: { include_valuation: 'false', limit: '2' } },
    { name: 'pool stats', call: api => api.getPoolStats('pool/key'), path: '/pools/pool%2Fkey/stats' },
    { name: 'pool trades', call: api => api.getPoolTrades('pool/key', { trade_type: 'swap', limit: 5 }), path: '/pools/pool%2Fkey/trades', query: { trade_type: 'swap', limit: '5' } },
    { name: 'display candles', call: api => api.getPoolOhlcv('pool/key', { granularity: '30m', from: 0, to: 3600, summary_from: 600, orientation: 'display' }), path: '/pools/pool%2Fkey/ohlcv', query: { granularity: '30m', from: '0', to: '3600', summary_from: '600', orientation: 'display' } },
  ]

  it.each(cases)('$name sends the public request and preserves its response envelope', async ({ call, path, query, response = { data: { value: 'exact' }, extra: 'preserved' } }) => {
    const { api, fetch } = fixture(response)
    await expect(call(api)).resolves.toEqual(response)
    expectRequest(fetch, path, { query })
  })

  it.each([
    ['explore pools', (api: ApiClient) => api.getExplorePools(), '/explore/pools'],
    ['explore tokens', (api: ApiClient) => api.getExploreTokens(), '/explore/tokens'],
    ['explore token', (api: ApiClient) => api.getExploreToken('1field'), '/explore/tokens/1field'],
    ['explore transactions', (api: ApiClient) => api.getExploreTransactions(), '/explore/transactions'],
    ['pool oracle', (api: ApiClient) => api.getPoolOracle('1field'), '/pools/1field/oracle'],
    ['protocol state', (api: ApiClient) => api.getProtocolState(), '/protocol/state'],
  ] as const)('%s leaves omitted options to the server', async (_name, call, path) => {
    const { api, fetch } = fixture({ data: {} })
    await call(api)
    expectRequest(fetch, path)
  })
})

describe('authenticated API endpoint contracts', () => {
  const activity = { action: 'create_pool' as const, tx_id: 'at1transaction', metadata: { pool: '1field' } }
  const batch = { code: 'REF123', blinded_addresses: ['aleo1blinded', 'aleo1other'] }
  const claim = { code: 'REF123', blinded_address: 'aleo1blinded' }
  const rebalance = { tick_lower: -100, tick_upper: 100, old_liquidity: '340282366920938463463374607431768211455', mint_tick_lower: -200, mint_tick_upper: 200 }
  const cases: Array<{
    name: string
    call: (api: ApiClient) => Promise<unknown>
    path: string
    query?: Record<string, string>
    body?: unknown
    unwrap?: boolean
  }> = [
    { name: 'rebalance snapshot', call: api => api.getRebalanceState('pool/key', rebalance), path: '/pools/pool%2Fkey/rebalance-state', query: Object.fromEntries(Object.entries(rebalance).map(([key, value]) => [key, String(value)])) },
    { name: 'route topology', call: api => api.getRouteTopology(), path: '/route/topology' },
    { name: 'unclaimed outputs', call: api => api.getUnclaimed(), path: '/unclaimed' },
    { name: 'referral activity', call: api => api.recordReferralActivity(activity), path: '/referral/activity', body: activity, unwrap: true },
    { name: 'referral address batch', call: api => api.recordReferralAddressBatch(batch), path: '/referral/address-batches', body: batch, unwrap: true },
    { name: 'referral swap claim', call: api => api.recordReferralSwapClaim(claim), path: '/referral/swap-claims', body: claim, unwrap: true },
    { name: 'pool-constrained route', call: api => api.getRoute({ token_in: '1field', token_out: '2field', amount_in: '0.125', pool_key: 'pool/key' }), path: '/route', query: { token_in: '1field', token_out: '2field', amount_in: '0.125', pool_key: 'pool/key' } },
    { name: 'own positions', call: api => api.getPositions(), path: '/positions' },
    { name: 'compatible positions filter', call: api => api.getPositions({ user: 'aleo1legacy', limit: 3 }), path: '/positions', query: { user: 'aleo1legacy', limit: '3' } },
  ]

  it.each(cases)('$name accepts API tokens and keeps the expected result shape', async ({ call, path, query, body, unwrap }) => {
    const response = { data: { recorded: true, count: 2 }, extra: 'preserved' }
    const { api, fetch } = fixture(response, { apiToken: 'ss_test' })
    await expect(call(api)).resolves.toEqual(unwrap ? response.data : response)
    expectRequest(fetch, path, { query, body, auth: 'ss_test' })
  })

  it.each(cases)('$name fails before fetching without a credential', async ({ call }) => {
    const { api, fetch } = fixture({})
    await expect(call(api)).rejects.toThrow(/requires auth/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads the admin role flag for an ordinary session and unwraps data', async () => {
    const { api, fetch } = fixture({ data: { is_admin: false } }, { apiToken: 'ss_test', session: 'jwt_test' })
    await expect(api.getReferralAdminStatus()).resolves.toEqual({ is_admin: false })
    expectRequest(fetch, '/referral/admin', { auth: 'jwt_test' })
  })

  it('requires a session for the admin role flag', async () => {
    const { api, fetch } = fixture({}, { apiToken: 'ss_test' })
    await expect(api.getReferralAdminStatus()).rejects.toThrow(/requires a session JWT/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('surfaces rejected attribution without reporting a recorded claim', async () => {
    const { api, fetch } = fixture({ error: 'another referral code holds this address' }, { apiToken: 'ss_test', status: 400 })
    await expect(api.recordReferralSwapClaim(claim)).rejects.toMatchObject({
      name: 'ApiError', status: 400, path: '/referral/swap-claims',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('surfaces a protocol revision pending response as an API error', async () => {
    const { api } = fixture({ error: 'protocol_revision_pending' }, { status: 503 })
    await expect(api.getProtocolState({ minimum_revision: 10 })).rejects.toBeInstanceOf(ApiError)
  })
})
