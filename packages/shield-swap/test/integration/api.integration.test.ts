import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import type { AnyAccount, Client } from '@provablehq/veil-core'
import { ApiClient, ApiError, authenticateWithAccount } from '../../src/api/client.js'

/**
 * Real-API integration: the whole read surface plus both auth flows against
 * the live DEX API. Never mocked — the generated OpenAPI types plus these
 * calls are the drift alarm for the service.
 *
 * Most of the API is bearer-gated, so the suite splits in two tiers:
 *   - public endpoints: VEIL_INTEGRATION=1 only
 *   - gated endpoints + auth flows: additionally VEIL_E2E_PRIVATE_KEY, whose
 *     account signs the challenge/verify handshake
 *
 * Mutating endpoints stay out of scope here except the API-token lifecycle,
 * which cleans up after itself (tokens are minted and revoked in one test).
 * The faucet and token registration are exercised by the e2e suites.
 */
const RUN = process.env.VEIL_INTEGRATION === '1'
const PRIVATE_KEY = process.env.VEIL_E2E_PRIVATE_KEY
const RUN_AUTHED = RUN && !!PRIVATE_KEY

// Prefix for tokens this suite mints; stale ones from crashed runs are swept
// in beforeAll so the account never hits the server's active-token limit.
const TEST_TOKEN_PREFIX = 'veil-itest-'

/** Revokes any unexpired test tokens this suite (or a crashed run) minted. */
async function sweepTestTokens(api: ApiClient): Promise<void> {
  for (const row of await api.listApiTokens()) {
    if (row.name.startsWith(TEST_TOKEN_PREFIX) && !row.revoked_at) await api.revokeApiToken(row.id)
  }
}

describe.runIf(RUN)('ApiClient against the live DEX API (public surface)', () => {
  const api = new ApiClient()

  it('pools: list → detail for a live pool', async () => {
    const pools = await api.getPools({ limit: 2 })
    expect(pools.data.length).toBeGreaterThan(0)
    const key = pools.data[0]!.key

    const pool = await api.getPool(key)
    expect(pool.data.key).toBe(key)
    expect(pool.data.token0_info?.decimals).toBeTypeOf('number')
  }, 30_000)

  it('tokens: list → detail', async () => {
    const tokens = await api.getTokens()
    expect(tokens.data.length).toBeGreaterThan(0)
    expect(tokens.data[0]!.address.endsWith('field')).toBe(true)

    const token = await api.getToken(tokens.data[0]!.address)
    expect(token.data.address).toBe(tokens.data[0]!.address)
  }, 30_000)

  it('gated endpoints reject a bad credential (server-side 401)', async () => {
    // An invalid token passes the client-side fail-fast, proving the server
    // itself gates — one request, both assertions on the captured error.
    const err = await new ApiClient({ apiToken: 'ss_invalid' }).getFeeTiers().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
  }, 30_000)
})

describe.runIf(RUN_AUTHED)('ApiClient auth flows against the live DEX API', () => {
  let api: ApiClient
  let account: AnyAccount
  let address: string

  beforeAll(async () => {
    const aleo = await loadNetwork('testnet')
    account = aleo.privateKeyToAccount(PRIVATE_KEY!)
    address = account.address

    api = new ApiClient()
    const jwt = await authenticateWithAccount(api, account)
    expect(jwt.length).toBeGreaterThan(0)

    // Sweep API tokens left behind by crashed runs.
    await sweepTestTokens(api)
  }, 60_000)

  it('session JWT covers the gated read surface', async () => {
    const pools = await api.getPools({ limit: 1 })
    const key = pools.data[0]!.key

    const stats = await api.getPoolStats(key)
    expect(stats).toBeTruthy()

    const trades = await api.getPoolTrades(key, { limit: 3 })
    expect(Array.isArray(trades.data)).toBe(true)

    const now = Math.floor(Date.now() / 1000)
    const candles = await api.getPoolOhlcv(key, { granularity: '1h', from: now - 86_400, to: now })
    expect(Array.isArray(candles.data)).toBe(true)

    const tiers = await api.getFeeTiers()
    expect(tiers.data.length).toBeGreaterThan(0)

    const spacings = await api.getTickSpacings()
    expect(spacings.data.length).toBeGreaterThan(0)

    const schemas = await api.getTradingSchemas()
    expect(schemas.data.length).toBeGreaterThan(0)
    const schema = await api.getTradingSchema(schemas.data[0]!.id)
    expect(schema.data.id).toBe(schemas.data[0]!.id)
  }, 60_000)

  it('route: quotes a path between a live pool\'s own pair', async () => {
    // A pool's own tokens always have at least the single-hop route through it.
    const pools = await api.getPools({ limit: 1 })
    const pool = pools.data[0]!
    const route = await api.getRoute({ token_in: pool.token0, token_out: pool.token1 })
    expect(route.data.hops.length).toBeGreaterThan(0)
  }, 30_000)

  it('user-scoped reads: swaps, positions, balances (drill into ids when present)', async () => {
    const swaps = await api.getSwaps({ user: address, limit: 3 })
    expect(Array.isArray(swaps.data)).toBe(true)
    if (swaps.data.length > 0) {
      const swap = await api.getSwap(swaps.data[0]!.id)
      expect(swap.data.id).toBe(swaps.data[0]!.id)
    }

    const positions = await api.getPositions({ user: address, limit: 3 })
    expect(Array.isArray(positions.data)).toBe(true)
    if (positions.data.length > 0) {
      const position = await api.getPosition(positions.data[0]!.token_id)
      expect(position.data.token_id).toBe(positions.data[0]!.token_id)
    }

    const balances = await api.getPublicBalances({ user: address })
    expect(Array.isArray(balances.data)).toBe(true)
  }, 60_000)

  it('debug pool introspection responds under auth', async () => {
    const pools = await api.getPools({ limit: 1 })
    const debug = await api.debugPool({ pool_key: pools.data[0]!.key })
    expect(debug).toBeTruthy()
  }, 30_000)

  it('airdrop status: auth accepted, unknown job is a 404 (not a 401)', async () => {
    // Proves the credential passes the gate without starting a faucet job.
    const err = await api.getAirdropStatus('00000000-0000-0000-0000-000000000000').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).not.toBe(401)
  }, 30_000)

  it('API token lifecycle: mint → use on gated reads → list → revoke → rejected', async () => {
    const name = `${TEST_TOKEN_PREFIX}${Date.now()}`
    const created = await api.createApiToken({ name, expires_in_days: 1 })
    expect(created.token.length).toBeGreaterThan(0)
    expect(created.name).toBe(name)
    expect(created.token.startsWith(created.token_prefix)).toBe(true)

    try {
      // The ss_ token alone covers data endpoints on a fresh client.
      const tokenClient = new ApiClient({ apiToken: created.token })
      const tiers = await tokenClient.getFeeTiers()
      expect(tiers.data.length).toBeGreaterThan(0)
      const balances = await tokenClient.getPublicBalances({ user: address })
      expect(Array.isArray(balances.data)).toBe(true)

      // …but not token management, client-side or server-side.
      await expect(tokenClient.listApiTokens()).rejects.toThrow(/session JWT/)

      const listed = await api.listApiTokens()
      expect(listed.some((t) => t.id === created.id)).toBe(true)
    } finally {
      const revoked = await api.revokeApiToken(created.id)
      expect(revoked).toEqual({ id: created.id, revoked: true })
    }

    // The revoked secret stops authenticating immediately.
    const revokedClient = new ApiClient({ apiToken: created.token })
    const err = await revokedClient.getFeeTiers().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
  }, 60_000)

  it('auto re-auth: a poisoned session heals on the next gated call', async () => {
    // Simulates JWT expiry: the stale token 401s, the stored signer renews
    // the session, and the call retries transparently.
    api.setToken('expired-garbage')
    const tiers = await api.getFeeTiers()
    expect(tiers.data.length).toBeGreaterThan(0)
  }, 30_000)

  it('agent auth tools drive the full token lifecycle end-to-end', async () => {
    const { createShieldSwapAgentTools } = await import('../../src/agent/index.js')
    // The auth tools need only the signing account from the client.
    const toolApi = new ApiClient()
    const tools = createShieldSwapAgentTools({
      client: { account } as unknown as Client,
      api: toolApi,
    })
    const call = async (name: string, input: Record<string, unknown> = {}) =>
      tools.find((t) => t.schema.name === name)!.handler(input)

    expect(await call('shield_swap_authenticate')).toEqual({ authenticated: true, address })

    const created = (await call('shield_swap_create_api_token', {
      name: `${TEST_TOKEN_PREFIX}agent-${Date.now()}`,
      expiresInDays: 1,
    })) as { id: string; token: string }
    try {
      expect(created.token.length).toBeGreaterThan(0)

      const listed = (await call('shield_swap_list_api_tokens')) as { tokens: Array<{ id: string }> }
      expect(listed.tokens.some((t) => t.id === created.id)).toBe(true)
    } finally {
      const revoked = (await call('shield_swap_revoke_api_token', { id: created.id })) as { revoked: boolean }
      expect(revoked.revoked).toBe(true)
    }
  }, 60_000)

  afterAll(async () => {
    // Belt and braces: leave no test tokens behind for the active-token limit.
    if (!api) return
    await sweepTestTokens(api).catch(() => {})
  }, 30_000)
})
