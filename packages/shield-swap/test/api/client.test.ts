import { describe, it, expect, vi } from 'vitest'
import { ApiClient, ApiError, DEFAULT_API_URL } from '../../src/api/client.js'

function fetchMock(responses: Array<{ status?: number; json: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  let i = 0
  const impl = vi.fn(async (url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const r = responses[Math.min(i++, responses.length - 1)]!
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: r.headers })
  }) as unknown as typeof fetch
  return { impl, calls }
}

// The current API delivers the session as httpOnly cookies on /auth/verify.
const SESSION_BODY = {
  data: { address: 'aleo1me', expires_at: 1753500000, csrf_token: 'csrf1', session_id: null, session_version: 1 },
}
const SESSION_HEADERS = {
  'set-cookie': 'ss_access=jwt123; HttpOnly; Path=/; SameSite=Lax',
}

describe('ApiClient', () => {
  it('builds URLs with query params and skips undefined', async () => {
    const { impl, calls } = fetchMock([{ json: { data: [], pagination: { total: 0, limit: 5, offset: 0 } } }])
    const client = new ApiClient({ fetch: impl })
    await client.getPools({ limit: 5, offset: undefined })
    expect(calls[0]!.url).toBe(`${DEFAULT_API_URL}/pools?limit=5`)
  })

  it('serializes bigint route amounts as strings', async () => {
    const { impl, calls } = fetchMock([{ json: { data: {} } }])
    const client = new ApiClient({ fetch: impl, apiToken: 'ss_live_abc' })
    await client.getRoute({ token_in: '1field', token_out: '2field', amount_in: 10n ** 18n })
    expect(calls[0]!.url).toContain('amount_in=1000000000000000000')
  })

  it('authenticate: challenge → sign → verify with challenge_id → session cookie becomes the bearer', async () => {
    const { impl, calls } = fetchMock([
      { json: { data: { challenge_id: 'ch1', message: 'sign me', nonce: 'n1' } } },
      { json: SESSION_BODY, headers: SESSION_HEADERS },
      { json: { data: { address: '1field', name: 'T', symbol: 'T', decimals: 6 } } },
    ])
    const client = new ApiClient({ fetch: impl })
    const sign = vi.fn(async (m: string) => `sign1-over-${m}`)
    const token = await client.authenticate('aleo1me', sign)

    expect(token).toBe('jwt123')
    expect(sign).toHaveBeenCalledWith('sign me')
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      address: 'aleo1me',
      signature: 'sign1-over-sign me',
      challenge_id: 'ch1',
    })

    await client.registerToken({ address: '1field', name: 'T', symbol: 'T', decimals: 6 })
    expect((calls[2]!.init.headers as Record<string, string>).authorization).toBe('Bearer jwt123')
  })

  it('authenticate accepts a body token from servers that still return one', async () => {
    const { impl } = fetchMock([
      { json: { data: { challenge_id: 'ch1', message: 'sign me', nonce: 'n1' } } },
      { json: { data: { token: 'jwt-body' } } },
    ])
    const client = new ApiClient({ fetch: impl })
    await expect(client.authenticate('aleo1me', async (m) => `sign1-over-${m}`)).resolves.toBe('jwt-body')
  })

  it('authenticate fails clearly when verify returns neither cookie nor token', async () => {
    const { impl } = fetchMock([
      { json: { data: { challenge_id: 'ch1', message: 'sign me', nonce: 'n1' } } },
      { json: SESSION_BODY },
    ])
    const client = new ApiClient({ fetch: impl })
    await expect(client.authenticate('aleo1me', async (m) => `sign1-over-${m}`)).rejects.toThrow(
      /no session credential/,
    )
  })

  it('auth-gated calls without a token fail fast with the remedy', async () => {
    const client = new ApiClient({ fetch: fetchMock([{ json: {} }]).impl })
    await expect(client.registerToken({ address: '1field', name: 'T', symbol: 'T', decimals: 6 })).rejects.toThrow(
      /requires auth — call authenticate/,
    )
  })

  it('apiToken from construction is attached to gated data endpoints', async () => {
    const { impl, calls } = fetchMock([{ json: { data: [] } }])
    const client = new ApiClient({ fetch: impl, apiToken: 'ss_live_abc' })
    await client.getFeeTiers()
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer ss_live_abc')
  })

  it('mints a short-lived WebSocket ticket with the active API credential', async () => {
    const { impl, calls } = fetchMock([{ json: { data: { token: 'ws-ticket', expires_at: 1_753_500_060 } } }])
    const client = new ApiClient({ fetch: impl, apiToken: 'ss_live_abc' })

    await expect(client.getWebSocketTicket()).resolves.toEqual({
      token: 'ws-ticket',
      expires_at: 1_753_500_060,
    })
    expect(calls[0]!.url).toBe(`${DEFAULT_API_URL}/auth/ws-ticket`)
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer ss_live_abc')
  })

  it('gated read endpoints without any credential fail fast with the remedy', async () => {
    const client = new ApiClient({ fetch: fetchMock([{ json: {} }]).impl })
    await expect(client.getRoute({ token_in: '1field', token_out: '2field' })).rejects.toThrow(
      /requires auth — call authenticate\(\) or pass apiToken/,
    )
  })

  it('session JWT wins over apiToken when both are present', async () => {
    const { impl, calls } = fetchMock([{ json: { data: [] } }])
    const client = new ApiClient({ fetch: impl, apiToken: 'ss_live_abc' })
    client.setToken('jwt456')
    await client.getFeeTiers()
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer jwt456')
  })

  it('createApiToken mints under the session JWT and returns the one-time secret', async () => {
    const { impl, calls } = fetchMock([
      { json: { data: { id: 'u1', name: 'bot', token: 'ss_live_new', token_prefix: 'ss_live_n', created_at: 'now' } } },
    ])
    const client = new ApiClient({ fetch: impl })
    client.setToken('jwt123')
    const created = await client.createApiToken({ name: 'bot', expires_in_days: 30 })
    expect(created.token).toBe('ss_live_new')
    expect(calls[0]!.url).toBe(`${DEFAULT_API_URL}/api-tokens`)
    expect(calls[0]!.init.method).toBe('POST')
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer jwt123')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ name: 'bot', expires_in_days: 30 })
  })

  it('listApiTokens and revokeApiToken round-trip under the session JWT', async () => {
    const { impl, calls } = fetchMock([
      { json: { data: { tokens: [{ id: 'u1', name: 'bot', token_prefix: 'ss_live_n', created_at: 'now' }] } } },
      { json: { data: { id: 'u1', revoked: true } } },
    ])
    const client = new ApiClient({ fetch: impl })
    client.setToken('jwt123')
    const tokens = await client.listApiTokens()
    expect(tokens).toHaveLength(1)
    expect(tokens[0]!.id).toBe('u1')
    const revoked = await client.revokeApiToken('u1')
    expect(revoked).toEqual({ id: 'u1', revoked: true })
    expect(calls[1]!.url).toBe(`${DEFAULT_API_URL}/api-tokens/u1`)
    expect(calls[1]!.init.method).toBe('DELETE')
  })

  it('token management refuses to run on an API token alone', async () => {
    const client = new ApiClient({ fetch: fetchMock([{ json: {} }]).impl, apiToken: 'ss_live_abc' })
    await expect(client.listApiTokens()).rejects.toThrow(/session JWT — call authenticate\(\)/)
  })

  it('authenticate retries the handshake when a concurrent login races the nonce', async () => {
    // Two clients authenticating the same address concurrently invalidate
    // each other's challenge nonce — verify 401s, and a fresh handshake heals.
    const { impl, calls } = fetchMock([
      { json: { data: { message: 'sign me', nonce: 'n1' } } },
      { status: 401, json: { error: 'authentication failed' } }, // raced verify
      { json: { data: { message: 'sign me 2', nonce: 'n2' } } },
      { json: { data: { token: 'jwt123' } } },
    ])
    const client = new ApiClient({ fetch: impl })
    const token = await client.authenticate('aleo1me', async (m) => `sign1-over-${m}`)
    expect(token).toBe('jwt123')
    expect(calls).toHaveLength(4)
    expect(JSON.parse(String(calls[3]!.init.body))).toEqual({ address: 'aleo1me', signature: 'sign1-over-sign me 2' })
  })

  it('authenticate gives up after bounded retries on persistent verify failure', async () => {
    const { impl, calls } = fetchMock([{ status: 401, json: { error: 'authentication failed' } }])
    const client = new ApiClient({ fetch: impl })
    await expect(client.authenticate('aleo1me', async (m) => `sign1-over-${m}`)).rejects.toThrow(/401/)
    // 3 attempts × (challenge + verify); the shared mock returns 401 to both.
    expect(calls.length).toBeLessThanOrEqual(6)
  })

  it('re-authenticates once and retries when a session JWT expires (401)', async () => {
    const { impl, calls } = fetchMock([
      { json: { data: { message: 'sign me', nonce: 'n1' } } }, // challenge
      { json: { data: { token: 'jwt-old' } } }, // verify
      { status: 401, json: { error: 'missing or invalid token' } }, // expired
      { json: { data: { message: 'sign me again', nonce: 'n2' } } }, // re-challenge
      { json: { data: { token: 'jwt-new' } } }, // re-verify
      { json: { data: [] } }, // retried call
    ])
    const client = new ApiClient({ fetch: impl })
    const sign = vi.fn(async (m: string) => `sign1-over-${m}`)
    await client.authenticate('aleo1me', sign)

    const tiers = await client.getFeeTiers()
    expect(tiers).toEqual({ data: [] })
    expect(sign).toHaveBeenCalledTimes(2)
    expect((calls[5]!.init.headers as Record<string, string>).authorization).toBe('Bearer jwt-new')
  })

  it('does not loop on a persistent 401 — one re-auth, then the error surfaces', async () => {
    const { impl, calls } = fetchMock([
      { json: { data: { message: 'sign me', nonce: 'n1' } } },
      { json: { data: { token: 'jwt-old' } } },
      { status: 401, json: { error: 'nope' } }, // gated call
      { json: { data: { message: 'sign me again', nonce: 'n2' } } },
      { json: { data: { token: 'jwt-new' } } },
      { status: 401, json: { error: 'still nope' } }, // retried call
    ])
    const client = new ApiClient({ fetch: impl })
    await client.authenticate('aleo1me', async (m) => `sign1-over-${m}`)
    await expect(client.getFeeTiers()).rejects.toThrow(/401/)
    expect(calls).toHaveLength(6)
  })

  it('autoReauthenticate: false surfaces the 401 without a new handshake', async () => {
    const { impl, calls } = fetchMock([
      { json: { data: { message: 'sign me', nonce: 'n1' } } },
      { json: { data: { token: 'jwt-old' } } },
      { status: 401, json: { error: 'expired' } },
    ])
    const client = new ApiClient({ fetch: impl, autoReauthenticate: false })
    await client.authenticate('aleo1me', async (m) => `sign1-over-${m}`)
    await expect(client.getFeeTiers()).rejects.toThrow(/401/)
    expect(calls).toHaveLength(3)
  })

  it('apiToken-only clients have no signer to re-auth with — 401 surfaces directly', async () => {
    const { impl, calls } = fetchMock([{ status: 401, json: { error: 'revoked' } }])
    const client = new ApiClient({ fetch: impl, apiToken: 'ss_live_dead' })
    await expect(client.getFeeTiers()).rejects.toThrow(/401/)
    expect(calls).toHaveLength(1)
  })

  it('getAccessStatus reads the invite gate under the session JWT', async () => {
    const { impl, calls } = fetchMock([{ json: { data: { has_access: false } } }])
    const client = new ApiClient({ fetch: impl })
    client.setToken('jwt123')
    const status = await client.getAccessStatus()
    expect(status.has_access).toBe(false)
    expect(calls[0]!.url).toBe(`${DEFAULT_API_URL}/access/status`)
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer jwt123')
  })

  it('redeemAccessCode posts the code; the session keeps its credential', async () => {
    const { impl, calls } = fetchMock([
      { json: { data: { code: 'INVITE1', status: 'redeemed' } } },
      { json: { data: [] } }, // subsequent gated call
    ])
    const client = new ApiClient({ fetch: impl })
    client.setToken('jwt-session')
    const redeemed = await client.redeemAccessCode('INVITE1')
    expect(redeemed.status).toBe('redeemed')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ code: 'INVITE1' })

    // The access grant is server-side; later calls keep the same session JWT.
    await client.getFeeTiers()
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer jwt-session')
  })

  it('access endpoints refuse to run on an API token alone', async () => {
    const client = new ApiClient({ fetch: fetchMock([{ json: {} }]).impl, apiToken: 'ss_live_abc' })
    await expect(client.getAccessStatus()).rejects.toThrow(/session JWT/)
  })

  it('redeemReferralCode posts the code; the session keeps its credential', async () => {
    const { impl, calls } = fetchMock([
      { json: { data: { code: 'REF1', status: 'redeemed' } } },
      { json: { data: [] } },
    ])
    const client = new ApiClient({ fetch: impl })
    client.setToken('jwt-session')
    const redeemed = await client.redeemReferralCode('REF1')
    expect(redeemed.status).toBe('redeemed')
    expect(calls[0]!.url).toBe(`${DEFAULT_API_URL}/referral/redeem`)
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ code: 'REF1' })

    await client.getFeeTiers()
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer jwt-session')
  })

  it('admin access-code inventory and generation round-trip under the session JWT', async () => {
    const { impl, calls } = fetchMock([
      { json: { data: { total: 1, redeemed: 0, available: 1, codes: [{ code: 'INVITE1', created_at: 'now' }] } } },
      { json: { data: { codes: ['INVITE2', 'INVITE3'] } } },
    ])
    const client = new ApiClient({ fetch: impl })
    client.setToken('jwt123')
    const inventory = await client.listAccessCodes()
    expect(inventory.available).toBe(1)
    const generated = await client.generateAccessCodes({ count: 2 })
    expect(generated.codes).toEqual(['INVITE2', 'INVITE3'])
    expect(calls[1]!.url).toBe(`${DEFAULT_API_URL}/access/generate`)
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ count: 2 })
  })

  it('non-2xx surfaces as ApiError with status and body', async () => {
    const { impl } = fetchMock([{ status: 404, json: { error: 'no such pool' } }])
    const client = new ApiClient({ fetch: impl })
    await expect(client.getPool('9field')).rejects.toThrow(ApiError)
    await expect(client.getPool('9field')).rejects.toThrow(/404/)
  })
})
