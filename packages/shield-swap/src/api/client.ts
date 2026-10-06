import { requestRecords, type AnyAccount, type Client, type RecordProvider } from '@provablehq/veil-core'
import type { components, operations } from './openapi.js'

type Schemas = components['schemas']

/**
 * The DEX API host serving each network.
 *
 * The deployment is per-network on separate domains, not one host with a network
 * segment — so a default has to know which chain the caller is on. Pointing a
 * testnet client at the mainnet host yields pools that do not exist on the
 * program it reads, which fails as a missing pool rather than as a bad URL.
 */
export const SHIELD_SWAP_API_URLS = {
  mainnet: 'https://api.swap.shield.fi',
  testnet: 'https://api.testnet.swap.shield.fi',
} as const

/**
 * Returns the DEX API host for a network.
 *
 * @param network Network the client reads, e.g. `'testnet'`. Anything other than
 *   `'mainnet'` resolves to the testnet host, since that is where a devnode or
 *   unnamed network's pools are indexed.
 * @returns The API origin, without a trailing slash.
 *
 * @example
 * new ApiClient({ baseUrl: defaultApiUrl('testnet') })
 */
export function defaultApiUrl(network: string | null | undefined): string {
  return network === 'mainnet' ? SHIELD_SWAP_API_URLS.mainnet : SHIELD_SWAP_API_URLS.testnet
}

/**
 * The DEX API a client defaults to when no network is known.
 *
 * @deprecated The API is per-network — use {@link defaultApiUrl} with the
 *   client's network, or let `shieldSwapActions` derive it. This constant
 *   previously pointed at `amm-api.dev.provable.com`, which indexes the
 *   pre-migration `shield_swap_v3.aleo` and serves pools that do not exist on
 *   `shield_swap.aleo`. Removed in the next major.
 */
export const DEFAULT_API_URL = SHIELD_SWAP_API_URLS.testnet

/**
 * Options for {@link ApiClient}.
 *
 * @property baseUrl DEX API origin, or a function that resolves it per
 *   request. Defaults to the testnet Shield Swap host; `shieldSwapActions`
 *   derives it from the client's network via {@link defaultApiUrl}.
 * @property fetch Custom fetch implementation (tests, polyfills). Defaults
 *   to the global fetch.
 * @property credentials Fetch cookie policy. Defaults to the fetch implementation's
 *   policy. Set `'include'` for browser sessions; cookies stay in the browser and
 *   {@link ApiClient.verifyAuthChallenge} returns their public session metadata.
 * @property apiToken Long-lived API token (`ss_…`) minted via
 *   {@link ApiClient.createApiToken}. Covers data and trading endpoints
 *   without a signature handshake — suited to bots, CI, and servers holding a
 *   provisioned key. Token management still requires a session JWT from
 *   {@link ApiClient.authenticate}.
 * @property autoReauthenticate Re-run the challenge/verify handshake and
 *   retry once when a gated call fails with 401 after
 *   {@link ApiClient.authenticate} — session JWTs expire after 15 minutes, so
 *   long-running processes heal without wiring their own retry. Defaults to
 *   true; set false to surface the 401 instead. Only applies when the client
 *   has authenticated (it needs the signer); apiToken-only clients cannot
 *   re-authenticate.
 */
export type ApiClientOptions = {
  baseUrl?: string | (() => string)
  fetch?: typeof fetch
  credentials?: RequestCredentials
  apiToken?: string
  autoReauthenticate?: boolean
}

/**
 * Outcome of {@link ApiClient.confirmAirdrop}.
 *
 * @property status `'settled'` when the faucet job finished and, if a scanner
 *   is configured, its successful transfers are readable as private records; or
 *   `'rate_limited'` when the faucet refused the address and nothing started.
 * @property job The finished job, with one result per token. Present on
 *   `'settled'`; a token's own `status` can still be `rejected` or `failed`.
 * @property message The faucet's explanation of the refusal. Present on
 *   `'rate_limited'`.
 */
export type ConfirmAirdropResult =
  | { status: 'settled'; job: Schemas['AirdropJob'] }
  | { status: 'rate_limited'; message: string }

/** A DEX API request that came back non-2xx, with the server's error body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    super(`DEX API ${status} on ${path}: ${body}`)
    this.name = 'ApiError'
  }
}

// Reads only named session cookies. Browsers hide Set-Cookie; Node exposes it.
function responseCookie(res: Response, name: string): string | undefined {
  const cookies: string[] =
    res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : [])
  for (const cookie of cookies) {
    const match = cookie.match(new RegExp(`(?:^|,\\s*)${name}=([^;,\\s]*)`))
    if (match) return decodeURIComponent(match[1]!)
  }
  return undefined
}

// Keeps legacy bearer credentials internal instead of leaking them in metadata.
function sessionMetadata(body: unknown): Schemas['SessionPayload'] | undefined {
  const data = (body as { data?: Partial<Schemas['SessionPayload']> } | undefined)?.data
  if (!data || typeof data.address !== 'string' || typeof data.csrf_token !== 'string' ||
    typeof data.expires_at !== 'number' || typeof data.session_version !== 'number') return undefined
  return {
    address: data.address,
    csrf_token: data.csrf_token,
    expires_at: data.expires_at,
    session_version: data.session_version,
    ...(data.session_id !== undefined ? { session_id: data.session_id } : {}),
    ...(data.server_time !== undefined ? { server_time: data.server_time } : {}),
  } as Schemas['SessionPayload']
}

/**
 * Typed client for the off-chain DEX (AMM) REST API.
 *
 * A trusted convenience layer — pool discovery, history, candles, route
 * quotes, the faucet, the token registry. Values that gate money movement
 * (swap outputs, blinded-address usage) MUST come from the chain reads
 * instead. All response types are generated from the service's own OpenAPI
 * spec (`pnpm regen-openapi`), so drift shows up as a type change, not a
 * runtime surprise.
 *
 * Auth: most endpoints beyond pool/token discovery are bearer-gated. Two
 * credentials work: a 15-minute session JWT from `authenticate()` (challenge/verify
 * signature handshake), or a long-lived API token (`ss_…`) passed as
 * `apiToken` at construction and minted once via `createApiToken()`. Gated
 * calls attach whichever is available (session JWT first); API-token
 * management accepts session JWTs only. Access is a second gate on top of
 * auth: an account that has not redeemed a referral code gets 403 from the
 * gated endpoints — see `getReferralStatus()` and `redeemReferralCode()`.
 * Every method hits the network.
 *
 * @example
 * const api = new ApiClient()
 * const pools = await api.getPools()
 * const route = await api.getRoute({ token_in, token_out, amount_in: '1.5' })
 */
export class ApiClient {
  private readonly resolveBaseUrl: () => string

  /**
   * Origin every request is built against, without a trailing slash.
   *
   * Read per request rather than fixed at construction, so a caller that derives
   * it from a client's network — as `shieldSwapActions` does — keeps talking to
   * the right deployment after `switchChain`.
   */
  get baseUrl(): string {
    return this.resolveBaseUrl()
  }
  private readonly fetchImpl: typeof fetch
  private readonly credentials: RequestCredentials | undefined
  private readonly apiToken: string | undefined
  private readonly autoReauthenticate: boolean
  private token: string | undefined
  private refreshToken: string | undefined
  private session: Schemas['SessionPayload'] | undefined
  private sessionOrigin: string | undefined
  private sessionGeneration = 0
  private refreshInFlight: { origin: string; generation: number; promise: Promise<Schemas['SessionPayload']> } | undefined
  // Kept from the last authenticate() call so an expired session can be
  // renewed transparently; shared promise dedupes concurrent renewals.
  private signer: { address: string; sign: (message: string) => Promise<string> } | undefined
  private reauthInFlight: Promise<string> | undefined

  constructor(options: ApiClientOptions = {}) {
    const configured = options.baseUrl ?? DEFAULT_API_URL
    this.resolveBaseUrl =
      typeof configured === 'function'
        ? () => configured().replace(/\/$/, '')
        : () => configured.replace(/\/$/, '')
    this.fetchImpl = options.fetch ?? fetch
    this.credentials = options.credentials
    this.apiToken = options.apiToken
    this.autoReauthenticate = options.autoReauthenticate ?? true
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    opts: Parameters<ApiClient['send']>[2] = {},
  ): Promise<T> {
    const res = await this.send(method, path, opts)
    return (await res.json()) as T
  }

  // Performs the HTTP exchange and returns the raw Response — the JSON-body
  // convenience lives in request(); callers that need headers (e.g. the
  // session cookie on /auth/verify) use this directly.
  private async send(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    opts: {
      query?: Record<string, string | number | boolean | undefined>
      body?: unknown
      // true: any credential (session JWT preferred, then API token).
      // 'session': session JWT only — the server rejects API tokens here.
      auth?: boolean | 'session' | 'optional-session'
      // Cookie-only refresh and idempotent logout can run without an access JWT.
      refresh?: boolean
      // Explicit session operations must never sign in again implicitly.
      reauthenticate?: boolean
      // Keeps a multi-request handshake on the deployment where it started.
      baseUrl?: string
      // Set internally on the post-re-auth retry so one 401 never loops.
      isRetry?: boolean
    } = {},
  ): Promise<Response> {
    const baseUrl = opts.baseUrl ?? this.baseUrl
    const url = new URL(baseUrl + path)
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
    const headers: Record<string, string> = { accept: 'application/json' }
    const generation = this.sessionGeneration
    const sameOrigin = this.sessionOrigin === url.origin
    const token = sameOrigin ? this.token : undefined
    const session = sameOrigin ? this.session : undefined
    const cookieAuth = this.credentials === 'include' || this.credentials === 'same-origin'
    if (opts.body !== undefined) headers['content-type'] = 'application/json'
    if (opts.auth === 'session' || opts.auth === 'optional-session') {
      if (!token && !cookieAuth && opts.auth === 'session') {
        throw new Error(`${path} requires a session JWT — call authenticate() first (API tokens are not accepted here)`)
      }
      if (token) headers.authorization = `Bearer ${token}`
    } else if (opts.auth) {
      const bearer = token ?? this.apiToken
      if (!bearer && !cookieAuth) throw new Error(`${path} requires auth — call authenticate() or pass apiToken at construction`)
      if (bearer) headers.authorization = `Bearer ${bearer}`
    }
    if ((opts.auth || opts.refresh) && session && (token || cookieAuth || opts.refresh)) {
      headers['x-shield-wallet-address'] = session.address
      if (session.session_id) headers['x-shield-session-id'] = session.session_id
      if (method !== 'GET') headers['x-csrf-token'] = session.csrf_token
    }
    if (opts.refresh && sameOrigin && this.refreshToken) {
      headers.cookie = `ss_refresh=${encodeURIComponent(this.refreshToken)}`
      if (session) headers.cookie += `; ss_csrf=${encodeURIComponent(session.csrf_token)}`
    }
    const res = await this.fetchImpl(url, {
      method,
      headers,
      ...(this.credentials !== undefined ? { credentials: this.credentials } : {}),
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
    if (!res.ok) {
      const error = new ApiError(res.status, path, await res.text())
      // An expired session JWT comes back 401; when the signer from
      // authenticate() is on hand, renew the session once and retry. A
      // failed renewal surfaces the original error — the caller asked for
      // this endpoint, not for the handshake.
      if (res.status === 401 && opts.auth && opts.reauthenticate !== false && !opts.isRetry &&
        sameOrigin && generation === this.sessionGeneration && new URL(this.baseUrl).origin === url.origin &&
        this.autoReauthenticate && this.signer) {
        try {
          await this.reauthenticate()
        } catch {
          throw error
        }
        return this.send(method, path, { ...opts, baseUrl, isRetry: true })
      }
      throw error
    }
    return res
  }

  /** Renews the session JWT via the stored signer, deduping concurrent renewals. */
  private async reauthenticate(): Promise<void> {
    const { address, sign } = this.signer!
    this.reauthInFlight ??= this.authenticate(address, sign).finally(() => {
      this.reauthInFlight = undefined
    })
    await this.reauthInFlight
  }

  // Invalidates pending credential adoption as well as the active session.
  private clearSession(): void {
    this.sessionGeneration++
    this.token = undefined
    this.refreshToken = undefined
    this.session = undefined
    this.sessionOrigin = undefined
    this.signer = undefined
  }

  private async readSessionResponse(res: Response, baseUrl: string, generation: number, replace = false) {
    const body: unknown = await res.json()
    const token = responseCookie(res, 'ss_access') ??
      (body as { data?: { token?: string } } | undefined)?.data?.token
    const metadata = sessionMetadata(body)
    const origin = new URL(baseUrl).origin
    const adopted = generation === this.sessionGeneration
    if (adopted) {
      if (replace || this.sessionOrigin !== origin) this.clearSession()
      this.sessionOrigin = origin
      if (token !== undefined) this.token = token || undefined
      const refresh = responseCookie(res, 'ss_refresh')
      if (refresh !== undefined) this.refreshToken = refresh || undefined
      if (metadata) this.session = metadata
    }
    return { token, metadata, adopted }
  }

  private async verifySession(body: Schemas['VerifyRequestDoc'], baseUrl: string, generation: number) {
    const res = await this.send('POST', '/auth/verify', { body, baseUrl })
    return this.readSessionResponse(res, baseUrl, generation, true)
  }

  // ── auth ─────────────────────────────────────────────────────────────

  /**
   * Requests the wallet message and nonce for a signature-based API login.
   *
   * Contacts the API without signing or replacing the active session.
   *
   * @param body Wallet address that will sign the returned message.
   * @returns The challenge identifier, nonce, and complete message to sign.
   * @throws If the API rejects the address or rate-limits challenge creation.
   * @example
   * const api = new ApiClient()
   * const challenge = await api.getAuthChallenge({ address: 'aleo1…' })
   */
  async getAuthChallenge(body: Schemas['ChallengeRequestDoc']): Promise<Schemas['ChallengePayload']> {
    const res = await this.request<Schemas['ChallengeResponseDoc']>('POST', '/auth/challenge', { body })
    return res.data
  }

  /**
   * Exchanges a signed challenge for a session and retains its credentials.
   *
   * Contacts the API and returns public session metadata. Browser callers MUST
   * configure `credentials: 'include'`; HttpOnly cookies remain browser-managed.
   * Node callers retain the access and refresh cookies on this instance.
   *
   * @param body Wallet address, challenge identifier, and signed challenge message.
   * @returns Session identity, CSRF token, and expiry in Unix seconds; never JWTs or refresh tokens.
   * @throws If verification fails or a legacy server returns no session metadata.
   * @example
   * const api = new ApiClient({ credentials: 'include' })
   * await api.verifyAuthChallenge({ address: 'aleo1…', challenge_id: 'challenge', signature: 'sign1…' })
   */
  async verifyAuthChallenge(body: Schemas['VerifyRequestDoc']): Promise<Schemas['SessionPayload']> {
    const result = await this.verifySession(body, this.baseUrl, this.sessionGeneration)
    if (!result.metadata) throw new ApiError(200, '/auth/verify', 'verify returned no session metadata; use authenticate() with legacy servers')
    return result.metadata
  }

  /**
   * Reads the current session and restores its CSRF and identity metadata.
   *
   * Contacts the API using a retained JWT or browser cookies, without signing.
   *
   * @returns Session identity and expiry in Unix seconds, without credential secrets.
   * @throws If no session exists, its JWT has expired, or the API cannot validate it.
   * @example
   * const api = new ApiClient({ credentials: 'include' })
   * const session = await api.getSession()
   */
  async getSession(): Promise<Schemas['SessionPayload']> {
    const baseUrl = this.baseUrl
    const generation = this.sessionGeneration
    const res = await this.send('GET', '/auth/session', { auth: 'session', reauthenticate: false, baseUrl })
    const result = await this.readSessionResponse(res, baseUrl, generation)
    if (!result.metadata) throw new ApiError(res.status, '/auth/session', 'session response contained no session metadata')
    return result.metadata
  }

  /**
   * Rotates the refresh cookie and retains the replacement session credentials.
   *
   * Contacts the API without signing; concurrent calls share one refresh request.
   * Requires a cookie from verification or a browser-managed cookie session.
   *
   * @returns Session identity and renewed access expiry in Unix seconds.
   * @throws If the refresh cookie is absent, expired, revoked, or concurrently rotated (409).
   * @example
   * const api = new ApiClient({ credentials: 'include' })
   * const session = await api.refreshSession()
   */
  async refreshSession(): Promise<Schemas['SessionPayload']> {
    const baseUrl = this.baseUrl
    const origin = new URL(baseUrl).origin
    const generation = this.sessionGeneration
    if (this.refreshInFlight?.origin === origin && this.refreshInFlight.generation === generation) {
      return this.refreshInFlight.promise
    }
    const cookieAuth = this.credentials === 'include' || this.credentials === 'same-origin'
    if (!(this.sessionOrigin === origin && this.refreshToken) && !cookieAuth) {
      throw new Error('/auth/refresh requires a refresh cookie — authenticate() first or enable browser credentials')
    }
    const promise = (async () => {
      const res = await this.send('POST', '/auth/refresh', { refresh: true, reauthenticate: false, baseUrl })
      const result = await this.readSessionResponse(res, baseUrl, generation)
      if (!result.metadata) throw new ApiError(res.status, '/auth/refresh', 'refresh response contained no session metadata')
      return result.metadata
    })().finally(() => {
      if (this.refreshInFlight?.promise === promise) this.refreshInFlight = undefined
    })
    this.refreshInFlight = { origin, generation, promise }
    return promise
  }

  /**
   * Ends the presented session family and clears local credentials when confirmed.
   *
   * Contacts the API without signing. An identity mismatch returns `ended: false`
   * and preserves the current session; a refresh-cookie logout requires metadata
   * previously read through verification or {@link getSession}.
   *
   * @returns Whether the API ended the expected session family.
   * @throws If the API rejects the session binding or CSRF token.
   * @example
   * const api = new ApiClient({ credentials: 'include' })
   * await api.getSession()
   * const result = await api.logout()
   */
  async logout(): Promise<Schemas['LogoutResponse']> {
    const baseUrl = this.baseUrl
    const generation = this.sessionGeneration
    const res = await this.request<Schemas['LogoutResponseDoc']>('POST', '/auth/logout', {
      auth: 'optional-session', refresh: true, reauthenticate: false, baseUrl,
    })
    if (res.data.ended && generation === this.sessionGeneration && this.sessionOrigin === new URL(baseUrl).origin) {
      this.clearSession()
    }
    return res.data
  }

  /**
   * Revokes every session for the authenticated wallet and forgets its local signer.
   *
   * Contacts the API without signing. Provisioned API tokens remain valid.
   *
   * @returns The affected wallet and its new session version.
   * @throws If session authentication or CSRF validation fails.
   * @example
   * const api = new ApiClient({ credentials: 'include' })
   * await api.getSession()
   * await api.logoutAll()
   */
  async logoutAll(): Promise<Schemas['LogoutAllResponse']> {
    const baseUrl = this.baseUrl
    const generation = this.sessionGeneration
    const res = await this.request<Schemas['LogoutAllResponseDoc']>('POST', '/auth/logout-all', {
      auth: 'session', reauthenticate: false, baseUrl,
    })
    if (res.data.ended && generation === this.sessionGeneration && this.sessionOrigin === new URL(baseUrl).origin) {
      this.clearSession()
    }
    return res.data
  }

  /**
   * Lists the authenticated wallet's active session families.
   *
   * Contacts the API using a session JWT or browser cookies; API tokens are rejected.
   *
   * @returns Session identifiers, activity times in Unix seconds, and the current-session marker.
   * @throws If session authentication fails or the API rate-limits session management.
   * @example
   * const api = new ApiClient({ credentials: 'include' })
   * const sessions = await api.listSessions()
   */
  async listSessions(): Promise<Schemas['ActiveSessionPayload'][]> {
    const res = await this.request<Schemas['ActiveSessionsResponseDoc']>('GET', '/auth/sessions', {
      auth: 'session', reauthenticate: false,
    })
    return res.data
  }

  /**
   * Revokes one session family belonging to the authenticated wallet.
   *
   * Contacts the API without signing and clears local credentials and the signer
   * when the revoked family is the current session.
   *
   * @param sessionId Session UUID returned by {@link listSessions}.
   * @returns Whether a family was revoked and whether it was the caller's session.
   * @throws If session authentication, CSRF validation, or session management fails.
   * @example
   * const api = new ApiClient({ credentials: 'include' })
   * await api.getSession()
   * await api.revokeSession('00000000-0000-4000-8000-000000000001')
   */
  async revokeSession(sessionId: string): Promise<Schemas['RevokeSessionPayload']> {
    const baseUrl = this.baseUrl
    const generation = this.sessionGeneration
    const res = await this.request<Schemas['RevokeSessionResponseDoc']>(
      'POST', `/auth/sessions/${encodeURIComponent(sessionId)}/revoke`,
      { auth: 'session', reauthenticate: false, baseUrl },
    )
    if (res.data.current && generation === this.sessionGeneration && this.sessionOrigin === new URL(baseUrl).origin) {
      this.clearSession()
    }
    return res.data
  }

  /**
   * Runs the challenge/verify handshake and stores the bearer token.
   *
   * The API authenticates by signature: it issues a nonce message, the
   * account signs it, and the signature is exchanged for a JWT. The token is
   * held on this instance and attached to auth-gated calls automatically.
   * The signer is retained so an expired session renews itself on the next
   * 401 (see `autoReauthenticate`).
   *
   * The handshake retries up to three times on a 401 — the server keeps one
   * active challenge per address, so concurrent logins race. A signer whose
   * signature the server persistently rejects is therefore invoked up to
   * three times before the error surfaces; an interactive wallet user may
   * see repeated signing prompts in that (misconfigured) case.
   *
   * @param address The authenticating account's address.
   * @param sign Signs the challenge message and returns an Aleo signature
   *   literal (`sign1…`) — e.g. wraps `account.signMessage`.
   * @returns The JWT, in case the caller wants to persist it.
   */
  async authenticate(address: string, sign: (message: string) => Promise<string>): Promise<string> {
    // The server keeps one active challenge per address, so concurrent
    // logins for the same account invalidate each other's nonce and verify
    // 401s. A fresh handshake heals that race — retry it a bounded number
    // of times; other failures (bad request, server error) surface at once.
    const attempts = 3
    const baseUrl = this.baseUrl
    const generation = this.sessionGeneration
    for (let attempt = 1; ; attempt++) {
      try {
        const challenge = await this.request<Schemas['ChallengeResponseDoc']>('POST', '/auth/challenge', {
          body: { address }, baseUrl,
        })
        const signature = await sign(challenge.data.message)
        // The session arrives as httpOnly cookies on the verify response, so
        // this call needs the raw Response headers — not just the JSON body.
        const result = await this.verifySession(
          { address, signature, challenge_id: challenge.data.challenge_id }, baseUrl, generation,
        )
        if (!result.token) {
          throw new ApiError(200, '/auth/verify', 'verify succeeded but carried no session credential (ss_access cookie or body token); browser callers use verifyAuthChallenge()')
        }
        if (!result.adopted) throw new ApiError(409, '/auth/verify', 'local session changed during authentication')
        this.signer = { address, sign }
        return result.token
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401 || attempt >= attempts) throw err
      }
    }
  }

  /**
   * Adopts a previously issued session JWT (e.g. persisted from a prior session).
   * Discards the previous session's refresh cookie, metadata, and retained signer.
   */
  setToken(token: string): void {
    const origin = new URL(this.baseUrl).origin
    this.clearSession()
    this.sessionOrigin = origin
    this.token = token
  }

  /**
   * Mints the short-lived credential accepted by the Shield Swap WebSocket.
   *
   * The gateway does not accept a session JWT or `ss_…` API token directly.
   * Call this immediately before opening or re-authenticating a socket, then
   * send the returned `token` in its `authenticate` frame.
   */
  async getWebSocketTicket(): Promise<Schemas['AuthTokenPayload']> {
    const res = await this.request<Schemas['AuthTokenResponseDoc']>('GET', '/auth/ws-ticket', { auth: true })
    return res.data
  }

  /**
   * Mints a long-lived API token (`ss_…`) under the current session JWT.
   *
   * The returned `token` is the full secret and is shown only once — the
   * caller MUST store it; later listings expose only the prefix. Pass the
   * secret as `apiToken` when constructing an {@link ApiClient} to skip the
   * signature handshake on subsequent sessions.
   *
   * @param body.name Label shown in listings (e.g. `"trading-bot"`).
   * @param body.expires_in_days Optional lifetime in days. Omitted or null
   *   means the token does not expire.
   * @returns The created token row including the one-time full secret.
   * @throws When no session JWT is held, or the server rejects the name,
   *   expiry, or active-token limit.
   *
   * @example
   * await authenticateWithAccount(api, account)
   * const { token } = await api.createApiToken({ name: 'trading-bot' })
   * // Store `token`; later sessions: new ApiClient({ apiToken: token })
   */
  async createApiToken(body: Schemas['ApiTokenCreateRequest']): Promise<Schemas['ApiTokenCreatedResponse']> {
    const res = await this.request<Schemas['ApiTokenCreatedResponseDoc']>('POST', '/api-tokens', {
      body,
      auth: 'session',
    })
    return res.data
  }

  /**
   * Lists the account's API tokens (prefixes only, never full secrets).
   *
   * Requires a session JWT — API tokens cannot inspect or manage tokens.
   */
  async listApiTokens(): Promise<Schemas['ApiTokenRow'][]> {
    const res = await this.request<Schemas['ApiTokenListResponseDoc']>('GET', '/api-tokens', { auth: 'session' })
    return res.data.tokens
  }

  /**
   * Revokes an API token by its id; the token stops authenticating immediately.
   *
   * Requires a session JWT — API tokens cannot inspect or manage tokens.
   *
   * @param id The token's uuid from {@link createApiToken} or {@link listApiTokens}.
   */
  async revokeApiToken(id: string): Promise<Schemas['ApiTokenRevokeResponse']> {
    const res = await this.request<Schemas['ApiTokenRevokeResponseDoc']>(
      'DELETE',
      `/api-tokens/${encodeURIComponent(id)}`,
      { auth: 'session' },
    )
    return res.data
  }

  // ── referral-code access ─────────────────────────────────────────────
  // Authentication alone does not unlock the gated endpoints: an account
  // must also have redeemed a referral code, or they return
  // 403 "redeem an invite code to unlock access". The retired `/access/*`
  // invite-code routes were removed server-side; referral codes are the
  // single access mechanism.

  /**
   * Reads whether the authenticated account has redeemed a referral code.
   *
   * Gated data and trading endpoints return 403 until access is granted —
   * check this after {@link authenticate} and prompt for a code when
   * `has_access` is false. Requires a session JWT.
   *
   * @returns `has_access`, plus the account's own referral `code` when one
   *   has been issued.
   * @throws When no session JWT is held.
   */
  async getReferralStatus(): Promise<Schemas['ReferralStatusResponse']> {
    const res = await this.request<Schemas['ReferralStatusResponseDoc']>('GET', '/referral/status', { auth: 'session' })
    return res.data
  }

  /**
   * Gets the authenticated wallet's shareable referral code, creating one when allowed.
   *
   * Contacts the DEX API with a session JWT. The server returns the existing
   * personal code or issues one if the wallet has none and issuance is enabled;
   * this request can create a code even though the endpoint uses GET.
   *
   * @returns The personal code, or a null/absent code when none can be issued.
   * @throws When no session JWT is held or the server rejects the request.
   * @example
   * const api = new ApiClient()
   * api.setToken(sessionJwt)
   * const { code } = await api.getMyReferralCode()
   */
  async getMyReferralCode(): Promise<Schemas['ReferralMyCodeResponse']> {
    const res = await this.request<Schemas['ReferralMyCodeResponseDoc']>('GET', '/referral/my-code', { auth: 'session' })
    return res.data
  }

  /**
   * Redeems a referral code, unlocking the gated endpoints for the account.
   *
   * The access grant is recorded server-side against the session — no new
   * credential is issued, and subsequent calls are unlocked without a new
   * handshake. One-time: the server rejects an already-used code with a
   * 400. Requires a session JWT.
   *
   * @param code The referral code to redeem.
   * @returns The redemption result (code and status).
   * @throws When no session JWT is held, or the code is invalid or already
   *   used (400).
   *
   * @example
   * await authenticateWithAccount(api, account)
   * if (!(await api.getReferralStatus()).has_access) {
   *   await api.redeemReferralCode(process.env.SHIELD_SWAP_INVITE_CODE!)
   * }
   */
  async redeemReferralCode(code: string): Promise<Schemas['ReferralRedeemResponse']> {
    const res = await this.request<Schemas['ReferralRedeemResponseDoc']>('POST', '/referral/redeem', {
      body: { code },
      auth: 'session',
    })
    return res.data
  }

  /**
   * Records a pool-creation activity claim for the authenticated wallet.
   *
   * Posts to the API using a session JWT or API token. This records attribution
   * metadata; it does not sign or submit an on-chain transaction.
   *
   * @param body Activity with `action: 'create_pool'`, a nonblank `tx_id` of at
   *   most 128 bytes, and optional JSON-object `metadata` of at most 1024 bytes.
   *   Omitted metadata defaults to an empty object on the server.
   * @returns Whether the server recorded the activity.
   * @throws When authentication is missing or the server rejects the activity.
   * @example
   * const api = new ApiClient({ apiToken: 'ss_token' })
   * await api.recordReferralActivity({ action: 'create_pool', tx_id: 'at1transaction' })
   */
  async recordReferralActivity(body: Schemas['ReferralActivityRequest']): Promise<Schemas['ReferralActivityResponse']> {
    const res = await this.request<Schemas['ReferralActivityResponseDoc']>('POST', '/referral/activity', { body, auth: true })
    return res.data
  }

  /**
   * Records referral links for a batch of blinded addresses.
   *
   * Posts attribution records using a session JWT or API token. The links are
   * unverified: authentication does not prove control of the blinded addresses.
   * This call does not sign, prove, or submit a transaction.
   *
   * @param body Redeemed referral `code` and `blinded_addresses` as Aleo address
   *   literals; the server accepts at most 250 unique addresses per batch.
   * @returns Counts of recorded, duplicate, and conflicting links.
   * @throws When authentication is missing or the server rejects the batch.
   * @example
   * const api = new ApiClient({ apiToken: 'ss_token' })
   * await api.recordReferralAddressBatch({ code: 'REF123', blinded_addresses: ['aleo1…'] })
   */
  async recordReferralAddressBatch(body: Schemas['ReferralAddressBatchRequest']): Promise<Schemas['ReferralAddressBatchResponse']> {
    const res = await this.request<Schemas['ReferralAddressBatchResponseDoc']>('POST', '/referral/address-batches', { body, auth: true })
    return res.data
  }

  /**
   * Reads whether the authenticated wallet has the referral administrator role.
   *
   * Contacts the API using a session JWT. Ordinary wallets may read this flag;
   * the call does not grant privileges or perform an administrator operation.
   *
   * @returns The wallet's `is_admin` flag.
   * @throws When no session JWT is held or the server rejects the request.
   * @example
   * const api = new ApiClient()
   * api.setToken('session-jwt')
   * const { is_admin } = await api.getReferralAdminStatus()
   */
  async getReferralAdminStatus(): Promise<Schemas['ReferralAdminCheckResponse']> {
    const res = await this.request<Schemas['ReferralAdminResponseDoc']>('GET', '/referral/admin', { auth: 'session' })
    return res.data
  }

  /**
   * Records an unverified referral link for one blinded address.
   *
   * Posts attribution using a session JWT or API token. Authentication does
   * not prove control of the address, and this does not claim swap funds or
   * sign, prove, or submit an on-chain transaction.
   *
   * @param body Redeemed referral `code` and the `blinded_address` Aleo literal.
   * @returns Whether the server inserted a new link; duplicates return false.
   * @throws When authentication is missing or the address conflicts or is invalid.
   * @example
   * const api = new ApiClient({ apiToken: 'ss_token' })
   * await api.recordReferralSwapClaim({ code: 'REF123', blinded_address: 'aleo1…' })
   */
  async recordReferralSwapClaim(body: Schemas['ReferralSwapClaimRequest']): Promise<Schemas['ReferralSwapClaimResponse']> {
    const res = await this.request<Schemas['ReferralSwapClaimResponseDoc']>('POST', '/referral/swap-claims', { body, auth: true })
    return res.data
  }

  // ── compliance ───────────────────────────────────────────────────────

  /**
   * Reads the indexed global compliance and pool-creation controls.
   *
   * Contacts the public API without authentication. The indexed response may
   * lag chain state; transaction decisions must use chain-backed reads.
   *
   * @returns The global controls in their API response envelope.
   * @throws When the API cannot supply the controls.
   * @example
   * const config = await new ApiClient().getComplianceConfig()
   */
  async getComplianceConfig(): Promise<Schemas['GlobalConfigResponseDoc']> {
    return this.request('GET', '/compliance')
  }

  /**
   * Reads a token's indexed allowlist and pause status.
   *
   * Contacts the public API without authentication; it does not alter controls.
   *
   * @param tokenId On-chain token identifier as an Aleo field literal.
   * @returns The token's compliance status in the API response envelope.
   * @throws When the API rejects the token or cannot supply its status.
   * @example
   * const status = await new ApiClient().getTokenCompliance('1field')
   */
  async getTokenCompliance(tokenId: string): Promise<Schemas['TokenComplianceResponseDoc']> {
    return this.request('GET', `/compliance/tokens/${encodeURIComponent(tokenId)}`)
  }

  /**
   * Reads a token pair's indexed compliance status.
   *
   * Contacts the public API without authentication; it does not alter controls.
   *
   * @param token0 First on-chain token identifier as an Aleo field literal.
   * @param token1 Second on-chain token identifier as an Aleo field literal.
   * @returns The pair's compliance status in the API response envelope.
   * @throws When the API rejects the pair or cannot supply its status.
   * @example
   * const status = await new ApiClient().getPairCompliance('1field', '2field')
   */
  async getPairCompliance(token0: string, token1: string): Promise<Schemas['PairComplianceResponseDoc']> {
    return this.request('GET', `/compliance/pairs/${encodeURIComponent(token0)}/${encodeURIComponent(token1)}`)
  }

  // ── market discovery ─────────────────────────────────────────────────

  /**
   * Lists indexed pool market metrics with search, sorting, and pagination.
   *
   * Contacts the public API without authentication. Omitted options are left
   * to the service's defaults rather than fixed by the SDK.
   *
   * @param query Optional `window` (1h, 1d, 1w, or 1m), `sort` field, `order`
   *   (asc or desc), `limit` (1–100 rows), `offset` (row count), and `search`
   *   text matching a symbol, name, token address, or pool key.
   * @returns Market rows, metric window, and pagination in the API envelope.
   * @throws When the server rejects the filters or cannot supply market data.
   * @example
   * const pools = await new ApiClient().getExplorePools({ window: '1d', limit: 10 })
   */
  async getExplorePools(query?: operations['explore_list_pools']['parameters']['query']): Promise<Schemas['ExplorePoolListResponseDoc']> {
    return this.request('GET', '/explore/pools', { query })
  }

  /**
   * Lists indexed token market metrics with search, sorting, and pagination.
   *
   * Contacts the public API without authentication. Omitted options retain
   * the service's defaults.
   *
   * @param query Optional `window` (1h, 1d, 1w, or 1m), `sort` field, `order`
   *   (asc or desc), `limit` (1–100 rows), `offset` (row count), and `search`
   *   text matching a symbol, name, or token address.
   * @returns Token market rows and pagination in the API response envelope.
   * @throws When the server rejects the filters or cannot supply market data.
   * @example
   * const tokens = await new ApiClient().getExploreTokens({ search: 'USDC', limit: 10 })
   */
  async getExploreTokens(query?: operations['explore_list_tokens']['parameters']['query']): Promise<Schemas['ExploreTokenListResponseDoc']> {
    return this.request('GET', '/explore/tokens', { query })
  }

  /**
   * Reads one indexed token's market metrics and associated pools.
   *
   * Contacts the public API without authentication.
   *
   * @param tokenId Indexed token address.
   * @param query Optional `window` (1h, 1d, 1w, or 1m); omission retains the
   *   service's default metric window.
   * @returns Token market detail in the API response envelope.
   * @throws When the token is unknown or the server rejects the window.
   * @example
   * const token = await new ApiClient().getExploreToken('1field', { window: '1w' })
   */
  async getExploreToken(tokenId: string, query?: operations['explore_get_token']['parameters']['query']): Promise<Schemas['ExploreTokenDetailResponseDoc']> {
    return this.request('GET', `/explore/tokens/${encodeURIComponent(tokenId)}`, { query })
  }

  /**
   * Lists the indexed market transaction feed with cursor pagination.
   *
   * Contacts the public API without authentication. Omitted options retain
   * the service's defaults; omitting the cursor starts the first page.
   *
   * @param query Optional `window` (1h, 1d, 1w, or 1m), `type` (swap, mint,
   *   or burn), `token` symbol/name/address, `pool` key, prior response
   *   `cursor`, and `limit` (1–100 rows). Omitted filters include all matches.
   * @returns Feed rows and the next cursor in the API response envelope.
   * @throws When the server rejects the filters or cannot supply the feed.
   * @example
   * const trades = await new ApiClient().getExploreTransactions({ type: 'swap', limit: 20 })
   */
  async getExploreTransactions(query?: operations['explore_list_transactions']['parameters']['query']): Promise<Schemas['ExploreTransactionListResponseDoc']> {
    return this.request('GET', '/explore/transactions', { query })
  }

  /**
   * Reads stored hourly USDC/USD prices over a Unix-second range.
   *
   * Contacts the public API without authentication. Hours without an accepted
   * price are absent; this method does not fill gaps or interpolate prices.
   *
   * @param query Inclusive `from` and exclusive `to` Unix timestamps in seconds
   *   (i64 numbers), with a positive span no greater than 31 days.
   * @returns Hourly prices ordered oldest first in the API response envelope.
   * @throws When the server rejects the range or cannot supply history.
   * @example
   * const prices = await new ApiClient().getUsdcUsdHistory({ from: 1_750_000_000, to: 1_750_003_600 })
   */
  async getUsdcUsdHistory(query: operations['prices_usdc_usd_history']['parameters']['query']): Promise<Schemas['UsdcUsdHistoryResponseDoc']> {
    return this.request('GET', '/prices/usdc-usd/history', { query })
  }

  // ── GeckoTerminal integration ────────────────────────────────────────

  /**
   * Reads public asset metadata in GeckoTerminal's response format.
   *
   * Contacts the API without authentication.
   *
   * @param id Indexed asset identifier.
   * @returns The complete response containing `asset`.
   * @throws When the asset is unknown or the API cannot supply metadata.
   * @example
   * const asset = await new ApiClient().getGeckoTerminalAsset('1field')
   */
  async getGeckoTerminalAsset(id: string): Promise<Schemas['AssetResponse']> {
    return this.request('GET', '/geckoterminal/asset', { query: { id } })
  }

  /**
   * Reads public pair metadata in GeckoTerminal's response format.
   *
   * Contacts the API without authentication.
   *
   * @param id Indexed pool identifier.
   * @returns The complete response containing `pair`.
   * @throws When the pair is unknown or the API cannot supply metadata.
   * @example
   * const pair = await new ApiClient().getGeckoTerminalPair('1field')
   */
  async getGeckoTerminalPair(id: string): Promise<Schemas['PairResponse']> {
    return this.request('GET', '/geckoterminal/pair', { query: { id } })
  }

  /**
   * Reads public swap events within an inclusive block-height range.
   *
   * Contacts the API without authentication. The service bounds the range and
   * event count; use smaller consecutive ranges when it rejects a large span.
   *
   * @param query Nonnegative `fromBlock` and `toBlock` heights as numbers,
   *   inclusive and ordered, within the service's indexed history.
   * @returns The complete GeckoTerminal response containing `events`.
   * @throws When the range is invalid, too large, or outside indexed history.
   * @example
   * const events = await new ApiClient().getGeckoTerminalEvents({ fromBlock: 100, toBlock: 110 })
   */
  async getGeckoTerminalEvents(query: operations['events']['parameters']['query']): Promise<Schemas['EventsResponse']> {
    return this.request('GET', '/geckoterminal/events', { query })
  }

  /**
   * Reads the latest block available to the public GeckoTerminal feed.
   *
   * Contacts the API without authentication. This checkpoint bounds event
   * history and can lag the live chain head.
   *
   * @returns The complete response containing the indexed `block` checkpoint.
   * @throws When the service cannot supply a checkpoint.
   * @example
   * const checkpoint = await new ApiClient().getGeckoTerminalLatestBlock()
   */
  async getGeckoTerminalLatestBlock(): Promise<Schemas['LatestBlockResponse']> {
    return this.request('GET', '/geckoterminal/latest-block')
  }

  // ── pools & markets ──────────────────────────────────────────────────

  /**
   * Lists pools and token metadata through the public API.
   *
   * Contacts the API without authentication.
   *
   * @param query Optional `limit` (1–100 rows, server default 20), `offset`
   *   (row count, default 0), and `include_valuation` (default false), which
   *   includes the server's USDC/USD valuation when requested.
   * @returns Pool rows and pagination in the API response envelope.
   * @throws When the API rejects pagination or cannot supply pools.
   * @example
   * const pools = await new ApiClient().getPools({ limit: 10, include_valuation: true })
   */
  async getPools(query?: operations['list_pools']['parameters']['query']): Promise<Schemas['PoolListResponseDoc']> {
    return this.request('GET', '/pools', { query })
  }

  /** Reads one pool with its current stats and token metadata. */
  async getPool(key: string): Promise<Schemas['PoolWithStatsResponseDoc']> {
    return this.request('GET', `/pools/${encodeURIComponent(key)}`)
  }

  /**
   * Reads a pool's rolling 24-hour price and volume summary.
   *
   * Contacts the public API without authentication.
   *
   * @param key Pool key as an Aleo field literal.
   * @returns The server's rolling price and volume statistics.
   * @throws When the pool is unknown or the API cannot supply statistics.
   * @deprecated Use getPool24hStats for the correct response envelope type.
   *   This legacy signature is retained until the next major release.
   * @example
   * const stats = await new ApiClient().getPoolStats('1field')
   */
  async getPoolStats(key: string): Promise<Schemas['PoolStatsDoc']> {
    return this.request('GET', `/pools/${encodeURIComponent(key)}/stats`)
  }

  /**
   * Reads a pool's public 24-hour statistics with the API response envelope.
   *
   * Contacts the API without requiring credentials. Missing price history can
   * leave interval-open prices null; current indexed statistics may lag chain state.
   *
   * @param key Pool key field literal to query.
   * @returns The generated response with rolling statistics under `data`.
   * @throws When the server cannot find the pool or rejects the request.
   * @example
   * const api = new ApiClient()
   * const { data } = await api.getPool24hStats('1field')
   */
  async getPool24hStats(key: string): Promise<Schemas['PoolStats24hResponseDoc']> {
    return this.request('GET', `/pools/${encodeURIComponent(key)}/stats`)
  }

  /**
   * Reads rolling 24-hour statistics for multiple pools in one public request.
   *
   * Contacts the API without authentication.
   *
   * @param query Comma-separated pool field literals in `keys`, at most 100
   *   unique keys; the service deduplicates them.
   * @returns Pool statistics in the API response envelope.
   * @throws When the API rejects the keys or cannot supply statistics.
   * @example
   * const stats = await new ApiClient().getPoolStatsBatch({ keys: '1field,2field' })
   */
  async getPoolStatsBatch(query: operations['get_pool_24h_stats_batch']['parameters']['query']): Promise<Schemas['PoolStats24hBatchResponseDoc']> {
    return this.request('GET', '/pools/stats', { query })
  }

  /**
   * Lists a pool's indexed trades with optional filtering and pagination.
   *
   * Contacts the public API without authentication.
   *
   * @param key Pool key as an Aleo field literal.
   * @param query Optional `limit` (1–100 rows, server default 20), `offset`
   *   (row count, default 0), and `trade_type` (omitted for all trade kinds).
   * @returns Trade rows and pagination in the API response envelope.
   * @throws When the pool or filter is invalid or trade data is unavailable.
   * @example
   * const trades = await new ApiClient().getPoolTrades('1field', { limit: 10 })
   */
  async getPoolTrades(
    key: string,
    query?: { limit?: number; offset?: number; trade_type?: string },
  ): Promise<Schemas['PoolTradesResponseDoc']> {
    return this.request('GET', `/pools/${encodeURIComponent(key)}/trades`, { query })
  }

  /**
   * Reads public OHLCV candles over a Unix-second time range.
   *
   * Contacts the API without authentication. The legacy `4h` granularity
   * remains accepted by the SDK for compatibility but current servers may
   * reject it; use a bucket from the generated `GranularityDoc` schema.
   *
   * @param key Pool key as an Aleo field literal.
   * @param query Candle `granularity`, inclusive `from` and exclusive `to`
   *   timestamps in Unix seconds (i64 numbers), and optional `orientation`:
   *   `raw` (default) reports token1 per token0; `display` uses the pool's
   *   canonical display direction and inverts candles when needed. Optional
   *   `summary_from` sets an exact summary start in Unix seconds, at or after
   *   `from` and before `to`; omission uses the requested candle range.
   * @returns Candle rows in the API response envelope.
   * @throws When the server rejects the pool, bucket, or time range.
   * @example
   * const candles = await new ApiClient().getPoolOhlcv('1field', {
   *   granularity: '1h', from: 1_750_000_000, to: 1_750_003_600, orientation: 'display',
   * })
   */
  async getPoolOhlcv(
    key: string,
    query: { granularity: Schemas['GranularityDoc'] | '4h'; from: number; to: number; summary_from?: number; orientation?: 'raw' | 'display' },
  ): Promise<Schemas['OhlcvResponseDoc']> {
    return this.request('GET', `/pools/${encodeURIComponent(key)}/ohlcv`, { query })
  }

  /**
   * Reads the indexed distribution of liquidity across a pool's ticks.
   *
   * Contacts the public API without authentication. Indexed data may lag chain
   * state and must not replace chain checks before moving funds.
   *
   * @param key Pool key as an Aleo field literal.
   * @returns Tick liquidity entries in the API response envelope; exact
   *   liquidity values remain decimal strings to preserve integer precision.
   * @throws When the pool is unknown or the service cannot supply its ticks.
   * @example
   * const liquidity = await new ApiClient().getPoolLiquidityDistribution('1field')
   */
  async getPoolLiquidityDistribution(key: string): Promise<Schemas['LiquidityDistributionResponseDoc']> {
    return this.request('GET', `/pools/${encodeURIComponent(key)}/liquidity-distribution`)
  }

  /**
   * Reads an indexed pool oracle snapshot for a time window.
   *
   * Contacts the public API without authentication; it does not update the
   * oracle or prove a transaction.
   *
   * @param key Pool key as an Aleo field literal.
   * @param query Optional `window_seconds` as a nonnegative u32 number;
   *   omission retains the service's default oracle window.
   * @returns The oracle snapshot in the API response envelope.
   * @throws When the window is invalid, history is unavailable (409), or the
   *   oracle is undeployed or unavailable (503).
   * @example
   * const oracle = await new ApiClient().getPoolOracle('1field', { window_seconds: 3600 })
   */
  async getPoolOracle(key: string, query?: operations['get_pool_oracle']['parameters']['query']): Promise<Schemas['PoolOracleResponseDoc']> {
    return this.request('GET', `/pools/${encodeURIComponent(key)}/oracle`, { query })
  }

  /**
   * Reads a pool snapshot and insertion hints for planning a rebalance.
   *
   * Contacts the API using a session JWT or API token. It does not sign,
   * prove, or submit a rebalance transaction.
   *
   * @param key Pool key as an Aleo field literal.
   * @param query Current `tick_lower`/`tick_upper`, proposed
   *   `mint_tick_lower`/`mint_tick_upper` (i32 numbers in [-400000, 400000],
   *   lower strictly below upper), and `old_liquidity` as an exact unsigned
   *   u128 decimal integer string. Ticks must respect the pool's spacing.
   * @returns Observed state and proposed mint hints in the API envelope.
   * @throws When credentials are missing or the server rejects the range or state.
   * @example
   * const api = new ApiClient({ apiToken: 'ss_token' })
   * const snapshot = await api.getRebalanceState('1field', {
   *   tick_lower: -100, tick_upper: 100, old_liquidity: '1000',
   *   mint_tick_lower: -200, mint_tick_upper: 200,
   * })
   */
  async getRebalanceState(key: string, query: operations['get_rebalance_state']['parameters']['query']): Promise<Schemas['RebalanceStateResponseDoc']> {
    return this.request('GET', `/pools/${encodeURIComponent(key)}/rebalance-state`, { query, auth: true })
  }

  // ── routing ──────────────────────────────────────────────────────────

  /**
   * Quotes the best route between two tokens (BFS, ≤ 3 hops).
   *
   * Use the quoted output as `expectedOut` for `swap`'s slippage math — a
   * wrong quote only widens protection, never moves funds.
   *
   * `amount_in` is a DECIMAL string in the input token's own units — `'0.5'`, not
   * `'500000'` — and `estimated_amount_out` comes back the same way, in the
   * output token's units. This is the one place the API departs from the base
   * units everything else here takes, and getting it wrong is expensive rather
   * than merely wrong: quoting `'500000'` for half a token returns the depth of
   * the pool, and a slippage floor built on that reverts on finalize.
   * `formatUnits` and `parseUnits` convert either way.
   *
   * Contacts the API using a session JWT or API token; it does not sign or
   * submit a swap.
   *
   * @param query Token ids as field literals, optional positive decimal
   *   `amount_in` (omitted for an unquoted route), and optional `pool_key` to
   *   constrain the route to one pool with no fallback. Omitting `pool_key`
   *   permits automatic routing across available pools.
   * @returns The route's hops and its quote, both in decimal units.
   * @throws When credentials are missing or the API rejects the route request.
   * @example
   * const api = new ApiClient({ apiToken: 'ss_token' })
   * const route = await api.getRoute({ token_in: '1field', token_out: '2field', amount_in: '0.5' })
   */
  async getRoute(query: {
    token_in: string
    token_out: string
    amount_in?: string
    pool_key?: string
  }): Promise<Schemas['RouteResponseDoc']> {
    return this.request('GET', '/route', {
      query: { token_in: query.token_in, token_out: query.token_out, amount_in: query.amount_in, pool_key: query.pool_key },
      auth: true,
    })
  }

  /**
   * Reads the current routing graph and maximum supported hop count.
   *
   * Contacts the API using a session JWT or API token. The graph describes
   * available token connections and does not itself quote or submit a swap.
   *
   * @returns Topology edges and hop limit in the API response envelope.
   * @throws When credentials are missing or routing data is unavailable.
   * @example
   * const topology = await new ApiClient({ apiToken: 'ss_token' }).getRouteTopology()
   */
  async getRouteTopology(): Promise<Schemas['RouteTopologyResponseDoc']> {
    return this.request('GET', '/route/topology', { auth: true })
  }

  // ── positions & tokens ───────────────────────────────────────────────

  /**
   * Lists the authenticated wallet's indexed liquidity positions.
   *
   * Contacts the API using a session JWT or API token. The server derives the
   * wallet from that credential. Read live per-position state from chain
   * with the `getPosition` action.
   *
   * @param query Optional `limit` (1–100 rows, server default 20) and `offset`
   *   (row count, default 0). The legacy `user` field is forwarded for backward
   *   compatibility but does not override the credential's wallet identity.
   * @returns Position rows and pagination in the API response envelope.
   * @throws When credentials are missing or the API cannot supply positions.
   * @example
   * const positions = await new ApiClient({ apiToken: 'ss_token' }).getPositions({ limit: 10 })
   */
  async getPositions(query?: { user?: string; limit?: number; offset?: number }): Promise<Schemas['PositionListResponseDoc']> {
    return this.request('GET', '/positions', { query, auth: true })
  }

  /**
   * Reads pending swap outputs and liquidity fees for the authenticated wallet.
   *
   * Contacts the API using a session JWT or API token. The server derives the
   * wallet from the credential. This read does not claim funds or submit a
   * transaction, and indexed results may lag chain state.
   *
   * @returns Pending swaps and positions with owed amounts in the API envelope;
   *   exact financial amounts remain decimal strings.
   * @throws When credentials are missing or the API cannot supply the wallet's data.
   * @example
   * const unclaimed = await new ApiClient({ apiToken: 'ss_token' }).getUnclaimed()
   */
  async getUnclaimed(): Promise<Schemas['UnclaimedResponseDoc']> {
    return this.request('GET', '/unclaimed', { auth: true })
  }

  /**
   * Lists all registered tokens with metadata.
   *
   * For one token's market metrics and associated pools, use
   * {@link getExploreToken} with its indexed address.
   */
  async getTokens(): Promise<Schemas['TokenListResponseDoc']> {
    return this.request('GET', '/tokens')
  }

  // ── protocol config ──────────────────────────────────────────────────

  /**
   * Reads the revisioned protocol deployment, controls, fees, and capabilities.
   *
   * Contacts the public API without authentication. Use the revision from a
   * protocol-config invalidation as the minimum to avoid accepting stale state.
   *
   * @param query Optional `minimum_revision` as a nonnegative i64 number;
   *   defaults to 0 on the server, allowing any available revision.
   * @returns The complete protocol-state response, without an added envelope.
   * @throws When the server cannot satisfy the requested revision (503), the
   *   revision is invalid, or the state cannot be loaded.
   * @example
   * const state = await new ApiClient().getProtocolState({ minimum_revision: 42 })
   */
  async getProtocolState(query?: { minimum_revision?: number }): Promise<Schemas['ProtocolStateResponse']> {
    return this.request('GET', '/protocol/state', { query })
  }

  /**
   * Lists registered fee tiers with their tick spacings.
   *
   * Each tier carries its tick spacing, so this also serves as the list of
   * registered spacings; the chain's `getFeeToTickSpacing` action reads one
   * tier's spacing directly.
   */
  async getFeeTiers(): Promise<Schemas['FeeTierListResponseDoc']> {
    return this.request('GET', '/fee-tiers', { auth: true })
  }

  /**
   * Lists a pool's initialized ticks, sorted ascending.
   *
   * Every `tick_lower` and `tick_upper` across the pool's non-burned positions,
   * deduplicated — enough to compute the insert hints `mint` asserts on without
   * deriving a tick key per candidate. `pickInsertHint` uses it when the WASM
   * peer needed to walk the on-chain list is unavailable.
   *
   * Indexed from positions rather than read from the contract's own linked
   * list, so it can lag a position minted moments ago. The chain is the
   * authority when a caller can reach it.
   *
   * @param poolKey Pool key field literal.
   * @returns `data` holds the sorted ticks as plain numbers (i32).
   */
  async getInitializedTicks(poolKey: string): Promise<Schemas['InitializedTicksResponseDoc']> {
    return this.request('GET', `/pools/${encodeURIComponent(poolKey)}/initialized-ticks`, { auth: true })
  }

  // ── utilities ────────────────────────────────────────────────────────

  /**
   * Starts a testnet faucet drop (1000 of each token) for an address.
   *
   * Asynchronous on the server: returns a `job_id` to poll with
   * {@link getAirdropStatus}. Used by the e2e to fund fresh accounts.
   *
   * Testnet only: the mainnet API does not serve `/airdrop` and answers 404.
   */
  async airdrop(address: string): Promise<Schemas['AirdropStartResult']> {
    const res = await this.request<{ data: Schemas['AirdropStartResult'] }>('POST', '/airdrop', {
      body: { address },
      auth: true,
    })
    return res.data
  }

  /**
   * Polls a faucet job until its per-token transfers complete.
   *
   * Testnet only: the mainnet API does not serve `/airdrop/{job_id}` and
   * answers 404.
   */
  async getAirdropStatus(jobId: string): Promise<Schemas['AirdropJob']> {
    const res = await this.request<{ data: Schemas['AirdropJob'] }>(
      'GET',
      `/airdrop/${encodeURIComponent(jobId)}`,
      { auth: true },
    )
    return res.data
  }

  /**
   * Requests a testnet faucet drop and waits for it to settle.
   *
   * Wraps {@link airdrop} and {@link getAirdropStatus}: starts the job, polls
   * until its status leaves `"running"`, and returns the finished job. When
   * called through a Shield Swap client with a record scanner, also waits for
   * each accepted or pending transfer's unspent, decrypted record. Resolves
   * wrapped tokens to their underlying record programs and matches transaction
   * IDs, so earlier balances cannot satisfy confirmation. Without a scanner,
   * only the faucet job is confirmed. A
   * faucet that refuses the address (one claim per address per window)
   * answers 429; that comes back as `status: 'rate_limited'` rather than
   * throwing, since an account that already holds funds can carry on. Every
   * other error propagates. A settled job can still carry a `rejected` or
   * `failed` per-token result, so a caller that needs a specific token checks
   * `job.results`.
   *
   * Testnet only: the mainnet API does not serve `/airdrop` and answers 404.
   * Hits the network to start, poll status, and scan records when configured.
   *
   * @param address The receiving account's address (`aleo1…`).
   * @param options.pollIntervalMs Milliseconds between status reads. Defaults
   *   to 5000; each token's transfer needs a confirmation, so polling faster
   *   only adds requests.
   * @param options.timeoutMs Total milliseconds to wait for the job and records before
   *   giving up. Defaults to 600000 (ten minutes), which covers every token's
   *   confirmation on a healthy network with room to spare.
   * @param options.recordClient Client supplying the recipient's record scanner.
   *   Automatically supplied by `shieldSwapActions`; omitted for a standalone
   *   API client unless explicitly configured for record confirmation.
   * @returns `{ status: 'settled', job }` with the per-token results, or
   *   `{ status: 'rate_limited', message }` when the faucet refused the address.
   * @throws When the job or records exceed `timeoutMs`, the scanner account
   *   differs from the recipient, or an API/record scan fails (except faucet 429).
   *
   * @example
   * const drop = await api.confirmAirdrop(account.address)
   * if (drop.status === 'settled') console.table(drop.job.results)
   * else console.log(drop.message)
   */
  async confirmAirdrop(
    address: string,
    options: { pollIntervalMs?: number; timeoutMs?: number; recordClient?: Client } = {},
  ): Promise<ConfirmAirdropResult> {
    const pollIntervalMs = options.pollIntervalMs ?? 5_000
    const timeoutMs = options.timeoutMs ?? 600_000
    const recordClient = options.recordClient
    const hasScanner = !!(recordClient as (Client & { recordProvider?: RecordProvider }) | undefined)?.recordProvider
    if (hasScanner && recordClient?.account?.address !== address) {
      throw new Error('Airdrop record confirmation requires the recipient to match the scanner account')
    }
    const deadline = Date.now() + timeoutMs

    let started: Schemas['AirdropStartResult']
    try {
      started = await this.airdrop(address)
    } catch (err) {
      // The faucet's per-address window: nothing started, nothing to poll.
      if (err instanceof ApiError && err.status === 429) return { status: 'rate_limited', message: err.message }
      throw err
    }

    let job = await this.getAirdropStatus(started.job_id)
    while (job.status === 'running') {
      if (Date.now() >= deadline) {
        throw new Error(
          `airdrop job ${started.job_id} is still running after ${timeoutMs}ms (${job.results.length} of ${job.total} tokens landed)`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      job = await this.getAirdropStatus(started.job_id)
    }
    if (hasScanner && recordClient) {
      // Match the faucet's actual transactions, never a pre-existing balance.
      const pending = job.results.filter((result) => result.status === 'accepted' || result.status === 'pending')
      if (pending.some((result) => !result.tx_id)) {
        throw new Error(`Airdrop job ${started.job_id} omitted a transaction id needed to confirm records`)
      }
      const tokens = pending.length ? (await this.getTokens()).data : []
      const remaining = pending.map((result) => ({
        transactionId: result.tx_id!.trim(),
        program: tokens.find((token) => token.amm_token_program === result.amm_token_program)?.underlying_program ?? result.amm_token_program,
      }))
      while (remaining.length) {
        for (const program of new Set(remaining.map((result) => result.program))) {
          // Page explicitly so old records cannot hide a newly indexed drop.
          for (let page = 0; ; page++) {
            const records = await requestRecords(recordClient, {
              program,
              includePlaintext: true,
              statusFilter: 'unspent',
              filter: { page, resultsPerPage: 1000 },
            })
            for (let i = remaining.length - 1; i >= 0; i--) {
              const found = remaining[i]!.program === program && records.some((record) =>
                record.transactionId?.trim() === remaining[i]!.transactionId &&
                'recordPlaintext' in record && !!record.recordPlaintext,
              )
              if (found) remaining.splice(i, 1)
            }
            if (records.length < 1000 || !remaining.some((result) => result.program === program)) break
            if (Date.now() >= deadline) break
          }
        }
        if (!remaining.length) break
        if (Date.now() >= deadline) {
          throw new Error(`Airdrop records for job ${started.job_id} are not readable after ${timeoutMs}ms (${remaining.length} transactions remaining)`)
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      }
    }
    return { status: 'settled', job }
  }

  /**
   * Raw on-chain pool introspection (slot + tick statuses) via the API.
   *
   * Testnet only: the mainnet API does not serve `/debug/pool` and answers 404.
   */
  async debugPool(query: { pool_key: string; ticks?: string }): Promise<Schemas['PoolDebugResponseDoc']> {
    return this.request('GET', '/debug/pool', { query, auth: true })
  }
}

/**
 * Runs {@link ApiClient.authenticate} with a Veil account as the signer.
 *
 * Bridges the account's byte-oriented `signMessage` to the string challenge
 * the DEX API issues. Hits the network (challenge + verify) and leaves the
 * session JWT on the client, so subsequent gated calls authenticate — and,
 * with `autoReauthenticate` (the default), renew — automatically.
 *
 * @param api The API client that receives the session.
 * @param account The signing account, e.g. `client.account`. Accepts
 *   `undefined` so call sites can pass an optional `client.account` directly.
 * @returns The session JWT, in case the caller wants to persist it.
 * @throws When `account` is undefined — the handshake needs a signer.
 *
 * @example
 * await authenticateWithAccount(client.api, client.account)
 * const tiers = await client.api.getFeeTiers()
 */
export async function authenticateWithAccount(api: ApiClient, account: AnyAccount | undefined): Promise<string> {
  if (!account) {
    throw new Error('DEX API authentication requires a client with an account — the account signs the challenge.')
  }
  return api.authenticate(account.address, async (message) =>
    new TextDecoder().decode(await account.signMessage(new TextEncoder().encode(message))),
  )
}
