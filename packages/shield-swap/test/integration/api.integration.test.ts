import { describe, it, expect } from 'vitest'
import { ApiClient } from '../../src/api/client.js'

// Real-API integration: the whole read surface against the live DEX API.
// Never mocked — the generated OpenAPI types plus these calls are the drift
// alarm for the service.
const RUN = process.env.VEIL_INTEGRATION === '1'

describe.runIf(RUN)('ApiClient against the live DEX API', () => {
  const api = new ApiClient()

  it('pools: list → detail → stats → trades for a live pool', async () => {
    const pools = await api.getPools({ limit: 2 })
    expect(pools.data.length).toBeGreaterThan(0)
    const key = pools.data[0]!.key

    const pool = await api.getPool(key)
    expect(pool.data.key).toBe(key)
    expect(pool.data.token0_info?.decimals).toBeTypeOf('number')

    const stats = await api.getPoolStats(key)
    expect(stats).toBeTruthy()

    const trades = await api.getPoolTrades(key, { limit: 3 })
    expect(Array.isArray(trades.data)).toBe(true)
  }, 30_000)

  it('ohlcv: candles decode for the last day', async () => {
    const pools = await api.getPools({ limit: 1 })
    const key = pools.data[0]!.key
    const now = Math.floor(Date.now() / 1000)
    const candles = await api.getPoolOhlcv(key, { granularity: '1h', from: now - 86_400, to: now })
    expect(Array.isArray(candles.data)).toBe(true)
  }, 30_000)

  it('tokens + fee tiers + tick spacings + trading schemas', async () => {
    const tokens = await api.getTokens()
    expect(tokens.data.length).toBeGreaterThan(0)
    expect(tokens.data[0]!.address.endsWith('field')).toBe(true)

    const token = await api.getToken(tokens.data[0]!.address)
    expect(token.data.address).toBe(tokens.data[0]!.address)

    const tiers = await api.getFeeTiers()
    expect(tiers.data.length).toBeGreaterThan(0)

    const spacings = await api.getTickSpacings()
    expect(spacings.data.length).toBeGreaterThan(0)

    const schemas = await api.getTradingSchemas()
    expect(schemas.data.length).toBeGreaterThan(0)
  }, 30_000)

  it('route: quotes a path between two live tokens', async () => {
    const tokens = await api.getTokens()
    expect(tokens.data.length).toBeGreaterThanOrEqual(2)
    const [a, b] = tokens.data
    const route = await api.getRoute({ token_in: a!.address, token_out: b!.address })
    // Route may legitimately not exist for an arbitrary pair — the call
    // succeeding with a typed shape is the contract here.
    expect(route).toBeTruthy()
  }, 30_000)

  it('auth challenge issues a nonce message (verify needs a signer — e2e)', async () => {
    const apiLocal = new ApiClient()
    // Any well-formed address can request a challenge.
    const challenge = await (apiLocal as unknown as {
      request: (m: string, p: string, o: object) => Promise<{ data: { message: string; nonce: string } }>
    }).request('POST', '/auth/challenge', {
      body: { address: 'aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px' },
    })
    expect(challenge.data.message.length).toBeGreaterThan(0)
    expect(challenge.data.nonce.length).toBeGreaterThan(0)
  }, 30_000)
})
