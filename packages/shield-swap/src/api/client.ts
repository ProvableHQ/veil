import type { AnyAccount } from '@provablehq/veil-core'
import type { components } from './openapi.js'

type Schemas = components['schemas']

/** The dev DEX API this client defaults to. */
export const DEFAULT_API_URL = 'https://amm-api.dev.provable.com'

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
  baseUrl?: string
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
 * auth: an account that has not redeemed an invite code gets 403 from the
 * gated endpoints — see `getAccessStatus()` and `redeemAccessCode()`. Every
 * method hits the network.
 *
 * @example
 * const api = new ApiClient()
 * const pools = await api.getPools()
 * const route = await api.getRoute({ tokenIn, tokenOut, amountIn: 10n ** 18n })
 */
export class ApiClient {
  readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly apiToken: string | undefined
  private readonly autoReauthenticate: boolean
  private token: string | undefined
  // Kept from the last authenticate() call so an expired session can be
  // renewed transparently; shared promise dedupes concurrent renewals.
  private signer: { address: string; sign: (message: string) => Promise<string> } | undefined
  private reauthInFlight: Promise<string> | undefined

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_API_URL).replace(/\/$/, '')
    this.fetchImpl = options.fetch ?? fetch
    this.apiToken = options.apiToken
    this.autoReauthenticate = options.autoReauthenticate ?? true
  }

  private async request<T>(
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
  ): Promise<T> {
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
        return this.request(method, path, { ...opts, isRetry: true })
      }
      throw error
    }
    return (await res.json()) as T
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
        const verified = await this.request<Schemas['AuthTokenResponseDoc']>('POST', '/auth/verify', {
          body: { address, signature },
        })
        this.signer = { address, sign }
        this.token = verified.data.token
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

  // ── invite-code access ───────────────────────────────────────────────
  // Authentication alone does not unlock the gated endpoints: an account
  // must also have redeemed an invite code, or they return
  // 403 "redeem an invite code to unlock access".

  /**
   * Reads whether the authenticated account has redeemed an invite code.
   *
   * Gated data and trading endpoints return 403 until access is granted —
   * check this after {@link authenticate} and prompt for a code when
   * `has_access` is false. Requires a session JWT.
   */
  async getAccessStatus(): Promise<Schemas['AccessStatusResponse']> {
    const res = await this.request<Schemas['AccessStatusResponseDoc']>('GET', '/access/status', { auth: 'session' })
    return res.data
  }

  /**
   * Redeems an invite code, unlocking the gated endpoints for the account.
   *
   * The response carries an upgraded session token with the access grant;
   * it replaces the session JWT held on this instance, so subsequent calls
   * are unlocked without a new handshake. One-time: the server rejects an
   * already-used code with a 400. Requires a session JWT.
   *
   * @param code The invite code to redeem.
   * @returns The redemption result (code, status, and the upgraded token).
   * @throws When no session JWT is held, or the code is invalid or already
   *   used (400).
   *
   * @example
   * await authenticateWithAccount(api, account)
   * if (!(await api.getAccessStatus()).has_access) {
   *   await api.redeemAccessCode(process.env.SHIELD_SWAP_INVITE_CODE!)
   * }
   */
  async redeemAccessCode(code: string): Promise<Schemas['AccessRedeemResponse']> {
    const res = await this.request<Schemas['AccessRedeemResponseDoc']>('POST', '/access/redeem', {
      body: { code },
      auth: 'session',
    })
    if (res.data.token) this.token = res.data.token
    return res.data
  }

  /**
   * Redeems a referral code, which also unlocks the gated endpoints for the
   * account — operationally interchangeable with {@link redeemAccessCode}
   * for first-time access (distributed codes are commonly referral codes).
   *
   * The response carries an upgraded session token with the access grant;
   * it replaces the session JWT held on this instance. One-time: the server
   * rejects an already-used code with a 400. Requires a session JWT.
   *
   * @param code The referral code to redeem.
   * @returns The redemption result (code, status, and the upgraded token).
   * @throws When no session JWT is held, or the code is invalid or already
   *   used (400).
   */
  async redeemReferralCode(code: string): Promise<Schemas['ReferralRedeemResponse']> {
    const res = await this.request<Schemas['ReferralRedeemResponseDoc']>('POST', '/referral/redeem', {
      body: { code },
      auth: 'session',
    })
    if (res.data.token) this.token = res.data.token
    return res.data
  }

  /**
   * Lists the invite-code inventory with redemption state (administrators
   * only — other accounts receive a 403). Requires a session JWT.
   */
  async listAccessCodes(): Promise<Schemas['AccessListResponse']> {
    const res = await this.request<Schemas['AccessListResponseDoc']>('GET', '/access/codes', { auth: 'session' })
    return res.data
  }

  /**
   * Generates new invite codes (administrators only — other accounts
   * receive a 403). Requires a session JWT.
   *
   * @param body.count Number of codes to mint.
   * @returns The newly minted codes.
   */
  async generateAccessCodes(body: Schemas['AccessGenerateRequest']): Promise<Schemas['AccessGenerateResponse']> {
    const res = await this.request<Schemas['AccessGenerateResponseDoc']>('POST', '/access/generate', {
      body,
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

  // ── swaps & routing ──────────────────────────────────────────────────

  /** Lists a user's swap history (paginated; the API requires `user`). */
  async getSwaps(query: { user: string; pool?: string; limit?: number; offset?: number }): Promise<Schemas['SwapListResponseDoc']> {
    return this.request('GET', '/swaps', { query, auth: true })
  }

  /** Reads one swap by id, with its hops and amounts. */
  async getSwap(swapId: string): Promise<Schemas['SwapResponseDoc']> {
    return this.request('GET', `/swaps/${encodeURIComponent(swapId)}`, { auth: true })
  }

  /**
   * Finds the best route between two tokens (BFS, ≤ 3 hops).
   *
   * Use the quoted output as `expectedOut` for `swap`'s slippage
   * math — a wrong quote only widens protection, never moves funds.
   */
  async getRoute(query: { token_in: string; token_out: string; amount_in?: bigint }): Promise<Schemas['RouteResponseDoc']> {
    return this.request('GET', '/route', {
      query: { token_in: query.token_in, token_out: query.token_out, amount_in: query.amount_in?.toString() },
      auth: true,
    })
  }

  // ── positions & tokens ───────────────────────────────────────────────

  /** Lists a user's liquidity positions (paginated). */
  async getPositions(query: { user: string; limit?: number; offset?: number }): Promise<Schemas['PositionListResponseDoc']> {
    return this.request('GET', '/positions', { query, auth: true })
  }

  /** Reads one position by its token id. */
  async getPosition(tokenId: string): Promise<Schemas['PositionResponseDoc']> {
    return this.request('GET', `/positions/${encodeURIComponent(tokenId)}`, { auth: true })
  }

  /** Lists all registered tokens with metadata. */
  async getTokens(): Promise<Schemas['TokenListResponseDoc']> {
    return this.request('GET', '/tokens')
  }

  /** Reads one token's metadata by its field address. */
  async getToken(address: string): Promise<Schemas['TokenResponseDoc']> {
    return this.request('GET', `/tokens/${encodeURIComponent(address)}`)
  }

  /** Registers a token with the DEX API (auth-gated). */
  async registerToken(body: Schemas['CreateTokenRequestDoc']): Promise<Schemas['TokenResponseDoc']> {
    return this.request('POST', '/tokens', { body, auth: true })
  }

  /** Reads a user's public/authorized balances (base units, as the API sees them). */
  async getPublicBalances(query: { user: string }): Promise<Schemas['BalanceListResponseDoc']> {
    return this.request('GET', '/balances', { query, auth: true })
  }

  // ── protocol config ──────────────────────────────────────────────────

  /** Lists registered fee tiers with their tick spacings. */
  async getFeeTiers(): Promise<Schemas['FeeTierListResponseDoc']> {
    return this.request('GET', '/fee-tiers', { auth: true })
  }

  /** Lists registered tick spacings. */
  async getTickSpacings(): Promise<Schemas['TickSpacingListResponseDoc']> {
    return this.request('GET', '/tick-spacings', { auth: true })
  }

  /** Lists the on-chain operation schemas the API publishes. */
  async getTradingSchemas(): Promise<Schemas['TradingSchemaListResponse']> {
    return this.request('GET', '/schema/trading', { auth: true })
  }

  /** Reads one operation schema by id (e.g. `"swap"`). */
  async getTradingSchema(id: string): Promise<Schemas['TradingSchemaResponse']> {
    return this.request('GET', `/schema/trading/${encodeURIComponent(id)}`, { auth: true })
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
