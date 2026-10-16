import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../../src/api/client.js'

const session = {
  address: 'aleo1wallet',
  csrf_token: 'csrf-1',
  expires_at: 1_800_000_900,
  server_time: 1_800_000_000,
  session_id: '00000000-0000-4000-8000-000000000001',
  session_version: 1,
}
const verification = { address: session.address, signature: 'sign1signature', challenge_id: 'challenge-1' }
const challenge = { challenge_id: 'challenge-1', message: 'Sign this challenge', nonce: 'nonce-1' }

function response(data: unknown, cookies: string[] = [], status = 200) {
  const headers = new Headers({ 'content-type': 'application/json' })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(JSON.stringify({ data }), { status, headers })
}

function sessionResponse(token = 'jwt-1', refresh = 'refresh-1') {
  return response(session, [
    `ss_access=${token}; Path=/; HttpOnly`,
    `ss_refresh=${refresh}; Path=/auth; HttpOnly`,
    'ss_csrf=csrf-1; Path=/; HttpOnly',
  ])
}

function transport(responses: Array<Response | Promise<Response>>) {
  const calls: Array<{ url: string; init: RequestInit; headers: Headers }> = []
  const fetch = vi.fn(async (url: URL | string | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, headers: new Headers(init?.headers) })
    const result = responses.shift()
    if (!result) throw new Error('Unexpected request')
    return result
  }) as unknown as typeof globalThis.fetch
  return { calls, fetch }
}

describe('API sessions', () => {
  it('exposes the signature steps and retains credentials without returning secrets', async () => {
    const { calls, fetch } = transport([
      response(challenge),
      response({ ...session, token: 'legacy-jwt', refresh_token: 'never-return' }, [
        'ss_access=jwt-1; Path=/; HttpOnly', 'ss_refresh=refresh-1; Path=/auth; HttpOnly',
      ]),
      response(session),
    ])
    const api = new ApiClient({ fetch })
    await expect(api.getAuthChallenge({ address: session.address })).resolves.toEqual(challenge)
    await expect(api.verifyAuthChallenge(verification)).resolves.toEqual(session)
    await expect(api.getSession()).resolves.toEqual(session)
    expect(calls.map(({ url, init }) => [new URL(url).pathname, init.method])).toEqual([
      ['/auth/challenge', 'POST'], ['/auth/verify', 'POST'], ['/auth/session', 'GET'],
    ])
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual(verification)
    expect(calls[2]!.headers.get('authorization')).toBe('Bearer jwt-1')
  })

  it('restores browser cookies and echoes session identity and CSRF on mutations', async () => {
    const { calls, fetch } = transport([
      response(session),
      response({ id: 'token-1', name: 'bot', token: 'ss_new', token_prefix: 'ss_n', created_at: 'now' }),
      response({ ok: true, revoked: true, current: false }),
    ])
    const api = new ApiClient({ fetch, credentials: 'include' })
    await api.getSession()
    await api.createApiToken({ name: 'bot' })
    await expect(api.revokeSession('other/id')).resolves.toEqual({ ok: true, revoked: true, current: false })
    expect(calls[2]!.url).toMatch(/\/auth\/sessions\/other%2Fid\/revoke$/)
    expect(calls[2]!.init.method).toBe('POST')
    for (const call of calls) expect(call.init.credentials).toBe('include')
    expect(calls[1]!.headers.get('authorization')).toBeNull()
    expect(calls[1]!.headers.get('x-csrf-token')).toBe('csrf-1')
    expect(calls[1]!.headers.get('x-shield-session-id')).toBe(session.session_id)
    expect(calls[1]!.headers.get('x-shield-wallet-address')).toBe(session.address)
  })

  it('establishes browser sessions without readable Set-Cookie headers', async () => {
    const { calls, fetch } = transport([response(session), response({ data: [] })])
    const api = new ApiClient({ fetch, credentials: 'include' })
    await expect(api.verifyAuthChallenge(verification)).resolves.toEqual(session)
    await api.getFeeTiers()
    expect(calls[1]!.headers.get('authorization')).toBeNull()
    expect(calls[1]!.init.credentials).toBe('include')
  })

  it('rotates Node refresh cookies and uses the new access JWT afterwards', async () => {
    const { calls, fetch } = transport([
      response(challenge), sessionResponse(), sessionResponse('jwt-2', 'refresh-2'),
      sessionResponse('jwt-3', 'refresh-3'), response([]),
    ])
    const api = new ApiClient({ fetch })
    await api.authenticate(session.address, async () => 'sign1signature')
    await expect(api.refreshSession()).resolves.toEqual(session)
    await api.refreshSession()
    await api.listSessions()
    expect(calls[2]!.headers.get('cookie')).toContain('ss_refresh=refresh-1')
    expect(calls[2]!.headers.get('x-shield-session-id')).toBe(session.session_id)
    expect(calls[3]!.headers.get('cookie')).toContain('ss_refresh=refresh-2')
    expect(calls[4]!.headers.get('authorization')).toBe('Bearer jwt-3')
    expect(calls[4]!.headers.get('cookie')).toBeNull()
  })

  it('deduplicates concurrent refresh requests', async () => {
    let finish!: (value: Response) => void
    let refreshCalls = 0
    const fetch = (async (url: URL | string | Request) => {
      if (String(url).endsWith('/auth/verify')) return sessionResponse()
      refreshCalls++
      return new Promise<Response>((resolve) => { finish = resolve })
    }) as typeof globalThis.fetch
    const api = new ApiClient({ fetch })
    await api.verifyAuthChallenge(verification)
    const pending = [api.refreshSession(), api.refreshSession()]
    expect(refreshCalls).toBe(1)
    finish(sessionResponse('jwt-2', 'refresh-2'))
    await expect(Promise.all(pending)).resolves.toEqual([session, session])
  })

  it('preserves refresh state on a concurrent-refresh 409', async () => {
    const { calls, fetch } = transport([
      sessionResponse(), response({ error: 'refresh in progress' }, [], 409), sessionResponse('jwt-2', 'refresh-2'),
    ])
    const api = new ApiClient({ fetch })
    await api.verifyAuthChallenge(verification)
    await expect(api.refreshSession()).rejects.toMatchObject({ status: 409 })
    await api.refreshSession()
    expect(calls[2]!.headers.get('cookie')).toContain('ss_refresh=refresh-1')
  })

  it('retains the session when logout reports an identity mismatch', async () => {
    const { calls, fetch } = transport([
      sessionResponse(), response({ ok: true, ended: false, session_id: null }), response([]),
    ])
    const api = new ApiClient({ fetch })
    await api.verifyAuthChallenge(verification)
    await expect(api.logout()).resolves.toEqual({ ok: true, ended: false, session_id: null })
    await expect(api.listSessions()).resolves.toEqual([])
    expect(calls[1]!.headers.get('cookie')).toContain('ss_refresh=refresh-1')
    expect(calls[1]!.headers.get('x-shield-session-id')).toBe(session.session_id)
    expect(calls[2]!.headers.get('authorization')).toBe('Bearer jwt-1')
  })

  it.each(['logout', 'logoutAll', 'revokeSession'] as const)('%s clears local credentials and the retained signer when the current session ends', async (method) => {
    const ended = method === 'revokeSession'
      ? { ok: true, revoked: true, current: true }
      : method === 'logoutAll'
        ? { ok: true, ended: true, address: session.address, session_version: 2 }
        : { ok: true, ended: true, session_id: session.session_id }
    const { calls, fetch } = transport([
      response(challenge), sessionResponse(), response(ended), response({ error: 'expired' }, [], 401),
    ])
    const sign = vi.fn(async () => 'sign1signature')
    const api = new ApiClient({ fetch })
    await api.authenticate(session.address, sign)
    await (method === 'revokeSession' ? api.revokeSession(session.session_id) : api[method]())
    await expect(api.listSessions()).rejects.toThrow(/session JWT/)
    api.setToken('another-expired-jwt')
    await expect(api.getFeeTiers()).rejects.toMatchObject({ status: 401 })
    expect(sign).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(4)
  })

  it('never starts a signature handshake to recover a failed logout-all', async () => {
    const { calls, fetch } = transport([
      response(challenge), sessionResponse(), response({ error: 'expired' }, [], 401),
    ])
    const sign = vi.fn(async () => 'sign1signature')
    const api = new ApiClient({ fetch })
    await api.authenticate(session.address, sign)
    await expect(api.logoutAll()).rejects.toMatchObject({ status: 401 })
    expect(sign).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(3)
  })

  it('does not reuse a retained session or signer on another API origin', async () => {
    let baseUrl = 'https://first.example'
    const { calls, fetch } = transport([response(challenge), sessionResponse()])
    const api = new ApiClient({ fetch, baseUrl: () => baseUrl })
    await api.authenticate(session.address, async () => 'sign1signature')
    baseUrl = 'https://second.example'
    await expect(api.getSession()).rejects.toThrow(/session JWT/)
    await expect(api.refreshSession()).rejects.toThrow(/refresh cookie/)
    expect(calls).toHaveLength(2)
  })

  it('uses only ambient cookies when browser mode changes API origin', async () => {
    let baseUrl = 'https://first.example'
    const { calls, fetch } = transport([sessionResponse(), response({ ...session, address: 'aleo1other' })])
    const api = new ApiClient({ fetch, credentials: 'include', baseUrl: () => baseUrl })
    await api.verifyAuthChallenge(verification)
    baseUrl = 'https://second.example'
    await api.getSession()
    expect(calls[1]!.headers.get('authorization')).toBeNull()
    expect(calls[1]!.headers.get('cookie')).toBeNull()
    expect(calls[1]!.headers.get('x-shield-session-id')).toBeNull()
    expect(calls[1]!.headers.get('x-csrf-token')).toBeNull()
  })

  it('does not transplant refresh cookies when adopting a JWT on another origin', async () => {
    let baseUrl = 'https://first.example'
    const { calls, fetch } = transport([sessionResponse(), response(session)])
    const api = new ApiClient({ fetch, baseUrl: () => baseUrl })
    await api.verifyAuthChallenge(verification)
    baseUrl = 'https://second.example'
    api.setToken('jwt-second-origin')
    await expect(api.refreshSession()).rejects.toThrow(/refresh cookie/)
    await api.getSession()
    expect(calls[1]!.headers.get('authorization')).toBe('Bearer jwt-second-origin')
    expect(calls[1]!.headers.get('x-shield-session-id')).toBeNull()
  })

  it('discards the previous account credentials and signer when adopting another JWT on the same origin', async () => {
    const { calls, fetch } = transport([
      response(challenge), sessionResponse(), response({ error: 'expired' }, [], 401),
      response({ ok: true, ended: false, session_id: null }),
    ])
    const sign = vi.fn(async () => 'sign1signature')
    const api = new ApiClient({ fetch })
    await api.authenticate(session.address, sign)
    api.setToken('jwt-other-account')
    await expect(api.refreshSession()).rejects.toThrow(/refresh cookie/)
    await expect(api.getFeeTiers()).rejects.toMatchObject({ status: 401 })
    await api.logout()
    expect(sign).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(4)
    expect(calls[3]!.headers.get('authorization')).toBe('Bearer jwt-other-account')
    expect(calls[3]!.headers.get('cookie')).toBeNull()
    expect(calls[3]!.headers.get('x-shield-session-id')).toBeNull()
    expect(calls[3]!.headers.get('x-shield-wallet-address')).toBeNull()
    expect(calls[3]!.headers.get('x-csrf-token')).toBeNull()
  })

  it('does not overwrite an adopted JWT when an earlier refresh finishes', async () => {
    let finish!: (value: Response) => void
    const { calls, fetch } = transport([
      sessionResponse(), new Promise((resolve) => { finish = resolve }), response([]),
    ])
    const api = new ApiClient({ fetch })
    await api.verifyAuthChallenge(verification)
    const pending = api.refreshSession()
    api.setToken('jwt-other-account')
    finish(sessionResponse('jwt-previous-account', 'refresh-previous-account'))
    await pending
    await api.listSessions()
    expect(calls[2]!.headers.get('authorization')).toBe('Bearer jwt-other-account')
    await expect(api.refreshSession()).rejects.toThrow(/refresh cookie/)
    expect(calls).toHaveLength(3)
  })

  it('keeps a reauthentication retry under the configured base path', async () => {
    const { calls, fetch } = transport([
      response(challenge), sessionResponse(), response({ error: 'expired' }, [], 401),
      response(challenge), sessionResponse('jwt-2', 'refresh-2'), response([]),
    ])
    const api = new ApiClient({ fetch, baseUrl: 'https://proxy.example/shield' })
    await api.authenticate(session.address, async () => 'sign1signature')
    await api.getFeeTiers()
    expect(calls[5]!.url).toBe('https://proxy.example/shield/fee-tiers')
  })

  it('does not reauthenticate a delayed 401 after the API origin changes', async () => {
    let expire!: (value: Response) => void
    let baseUrl = 'https://first.example'
    const { calls, fetch } = transport([
      response(challenge), sessionResponse(), new Promise((resolve) => { expire = resolve }),
      response(challenge), sessionResponse('jwt-second-origin', 'refresh-second-origin'),
    ])
    const sign = vi.fn(async () => 'sign1signature')
    const api = new ApiClient({ fetch, baseUrl: () => baseUrl })
    await api.authenticate(session.address, sign)
    const pending = api.getFeeTiers()
    baseUrl = 'https://second.example'
    expire(response({ error: 'expired' }, [], 401))
    await expect(pending).rejects.toMatchObject({ status: 401 })
    expect(calls).toHaveLength(3)
    expect(sign).toHaveBeenCalledTimes(1)
  })

  it('does not restore credentials when an in-flight refresh finishes after logout', async () => {
    let finish!: (value: Response) => void
    const { calls, fetch } = transport([
      sessionResponse(), new Promise((resolve) => { finish = resolve }),
      response({ ok: true, ended: true, session_id: session.session_id }),
    ])
    const api = new ApiClient({ fetch })
    await api.verifyAuthChallenge(verification)
    const pending = api.refreshSession()
    await api.logout()
    finish(sessionResponse('jwt-after-logout', 'refresh-after-logout'))
    await pending
    await expect(api.listSessions()).rejects.toThrow(/session JWT/)
    await expect(api.refreshSession()).rejects.toThrow(/refresh cookie/)
    expect(calls).toHaveLength(3)
  })

  it('rejects API-token-only access to session management and refresh', async () => {
    const { calls, fetch } = transport([])
    const api = new ApiClient({ fetch, apiToken: 'ss_provisioned' })
    await expect(api.getSession()).rejects.toThrow(/session JWT/)
    await expect(api.listSessions()).rejects.toThrow(/session JWT/)
    await expect(api.logoutAll()).rejects.toThrow(/session JWT/)
    await expect(api.revokeSession(session.session_id)).rejects.toThrow(/session JWT/)
    await expect(api.refreshSession()).rejects.toThrow(/refresh cookie/)
    expect(calls).toHaveLength(0)
  })
})
