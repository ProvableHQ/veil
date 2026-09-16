import type { AnyAccount } from '@provablehq/veil-core'
import type { components } from './openapi.js'

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
 * @property baseUrl DEX API origin. Defaults to the Provable dev API.
 * @property fetch Custom fetch implementation (tests, polyfills). Defaults
 *   to the global fetch.
 * @property apiToken Long-lived API token (`ss_…`) minted via
 *   {@link ApiClient.createApiToken}. Covers data and trading endpoints
 *   without a signature handshake — suited to bots, CI, and servers holding a
 *   provisioned key. Token management still requires a session JWT from
 *   {@link ApiClient.authenticate}.
 * @property autoReauthenticate Re-run the challenge/verify handshake and
 *   retry once when a gated call fails with 401 after
 *   {@link ApiClient.authenticate} — session JWTs expire after ~24h, so
 *   long-running processes heal without wiring their own retry. Defaults to
 *   true; set false to surface the 401 instead. Only applies when the client
 *   has authenticated (it needs the signer); apiToken-only clients cannot
 *   re-authenticate.
 */
export type ApiClientOptions = {
  baseUrl?: string | (() => string)
  fetch?: typeof fetch
  apiToken?: string
  autoReauthenticate?: boolean
}

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

// Extracts the session credential from a verify response. Current servers
// deliver the session JWT as the `ss_access` httpOnly cookie (the middleware
// also accepts it as a Bearer); a body token, returned by older servers, is
// the fallback.
function sessionTokenFrom(res: Response, body: unknown): string | undefined {
  const cookies: string[] =
    res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : [])
  for (const cookie of cookies) {
    const match = cookie.match(/^ss_access=([^;]+)/)
    if (match) return decodeURIComponent(match[1]!)
  }
  return (body as { data?: { token?: string } } | undefined)?.data?.token
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
 * credentials work: a 24h session JWT from `authenticate()` (challenge/verify
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
  private readonly apiToken: string | undefined
  private readonly autoReauthenticate: boolean
  private token: string | undefined
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
      query?: Record<string, string | number | undefined>
      body?: unknown
      // true: any credential (session JWT preferred, then API token).
      // 'session': session JWT only — the server rejects API tokens here.
      auth?: boolean | 'session'
      // Set internally on the post-re-auth retry so one 401 never loops.
      isRetry?: boolean
    } = {},
  ): Promise<Response> {
    const url = new URL(this.baseUrl + path)
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
    const headers: Record<string, string> = { accept: 'application/json' }
    if (opts.body !== undefined) headers['content-type'] = 'application/json'
    if (opts.auth === 'session') {
      if (!this.token) {
        throw new Error(`${path} requires a session JWT — call authenticate() first (API tokens are not accepted here)`)
      }
      headers.authorization = `Bearer ${this.token}`
    } else if (opts.auth) {
      const bearer = this.token ?? this.apiToken
      if (!bearer) throw new Error(`${path} requires auth — call authenticate() or pass apiToken at construction`)
      headers.authorization = `Bearer ${bearer}`
    }
    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
    if (!res.ok) {
      const error = new ApiError(res.status, path, await res.text())
      // An expired session JWT comes back 401; when the signer from
      // authenticate() is on hand, renew the session once and retry. A
      // failed renewal surfaces the original error — the caller asked for
      // this endpoint, not for the handshake.
      if (res.status === 401 && opts.auth && !opts.isRetry && this.autoReauthenticate && this.signer) {
        try {
          await this.reauthenticate()
        } catch {
          throw error
        }
        return this.send(method, path, { ...opts, isRetry: true })
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

  // ── auth ─────────────────────────────────────────────────────────────

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
    for (let attempt = 1; ; attempt++) {
      try {
        const challenge = await this.request<Schemas['ChallengeResponseDoc']>('POST', '/auth/challenge', {
          body: { address },
        })
        const signature = await sign(challenge.data.message)
        // The session arrives as httpOnly cookies on the verify response, so
        // this call needs the raw Response headers — not just the JSON body.
        const res = await this.send('POST', '/auth/verify', {
          body: { address, signature, challenge_id: challenge.data.challenge_id },
        })
        const token = sessionTokenFrom(res, await res.json())
        if (!token) {
          throw new ApiError(res.status, '/auth/verify', 'verify succeeded but carried no session credential (ss_access cookie or body token)')
        }
        this.signer = { address, sign }
        this.token = token
        return this.token
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401 || attempt >= attempts) throw err
      }
    }
  }

  /** Adopts a previously issued session JWT (e.g. persisted from a prior session). */
  setToken(token: string): void {
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

  // ── pools & markets ──────────────────────────────────────────────────

  /** Lists pools with token metadata (paginated). */
  async getPools(query?: { limit?: number; offset?: number }): Promise<Schemas['PoolListResponseDoc']> {
    return this.request('GET', '/pools', { query })
  }

  /** Reads one pool with its current stats and token metadata. */
  async getPool(key: string): Promise<Schemas['PoolWithStatsResponseDoc']> {
    return this.request('GET', `/pools/${encodeURIComponent(key)}`)
  }

  /** Reads a pool's rolling 24h price/volume summary. */
  async getPoolStats(key: string): Promise<Schemas['PoolStatsDoc']> {
    return this.request('GET', `/pools/${encodeURIComponent(key)}/stats`, { auth: true })
  }

  /** Lists a pool's trades, optionally filtered by kind (paginated). */
  async getPoolTrades(
    key: string,
    query?: { limit?: number; offset?: number; trade_type?: string },
  ): Promise<Schemas['PoolTradesResponseDoc']> {
    return this.request('GET', `/pools/${encodeURIComponent(key)}/trades`, { query, auth: true })
  }

  /** Reads OHLCV candles for a pool over a unix-seconds time range. */
  async getPoolOhlcv(
    key: string,
    query: { granularity: '1m' | '5m' | '15m' | '1h' | '4h' | '1d'; from: number; to: number },
  ): Promise<Schemas['OhlcvResponseDoc']> {
    return this.request('GET', `/pools/${encodeURIComponent(key)}/ohlcv`, { query, auth: true })
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
   * @param query Token ids as field literals, and the optional decimal amount.
   * @returns The route's hops and its quote, both in decimal units.
   */
  async getRoute(query: {
    token_in: string
    token_out: string
    amount_in?: string
  }): Promise<Schemas['RouteResponseDoc']> {
    return this.request('GET', '/route', {
      query: { token_in: query.token_in, token_out: query.token_out, amount_in: query.amount_in },
      auth: true,
    })
  }

  // ── positions & tokens ───────────────────────────────────────────────

  /**
   * Lists a user's liquidity positions (paginated).
   *
   * The API has no per-position detail route; read one position's live
   * state from chain with the `getPosition` action instead.
   */
  async getPositions(query: { user: string; limit?: number; offset?: number }): Promise<Schemas['PositionListResponseDoc']> {
    return this.request('GET', '/positions', { query, auth: true })
  }

  /**
   * Lists all registered tokens with metadata.
   *
   * The API has no per-token detail route; resolve one token by filtering
   * this list on its field address.
   */
  async getTokens(): Promise<Schemas['TokenListResponseDoc']> {
    return this.request('GET', '/tokens')
  }

  // ── protocol config ──────────────────────────────────────────────────

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
   */
  async airdrop(address: string): Promise<Schemas['AirdropStartResult']> {
    const res = await this.request<{ data: Schemas['AirdropStartResult'] }>('POST', '/airdrop', {
      body: { address },
      auth: true,
    })
    return res.data
  }

  /** Polls a faucet job until its per-token transfers complete. */
  async getAirdropStatus(jobId: string): Promise<Schemas['AirdropJob']> {
    const res = await this.request<{ data: Schemas['AirdropJob'] }>(
      'GET',
      `/airdrop/${encodeURIComponent(jobId)}`,
      { auth: true },
    )
    return res.data
  }

  /** Raw on-chain pool introspection (slot + tick statuses) via the API. */
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
