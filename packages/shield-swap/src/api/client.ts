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
 */
export type ApiClientOptions = {
  baseUrl?: string
  fetch?: typeof fetch
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
 * Auth: `authenticate()` runs the challenge/verify handshake and stores the
 * JWT; auth-gated calls attach it automatically. Every method hits the
 * network.
 *
 * @example
 * const api = new ApiClient()
 * const pools = await api.getPools()
 * const route = await api.getRoute({ tokenIn, tokenOut, amountIn: 10n ** 18n })
 */
export class ApiClient {
  readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private token: string | undefined

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_API_URL).replace(/\/$/, '')
    this.fetchImpl = options.fetch ?? fetch
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path)
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
    const headers: Record<string, string> = { accept: 'application/json' }
    if (opts.body !== undefined) headers['content-type'] = 'application/json'
    if (opts.auth) {
      if (!this.token) throw new Error(`${path} requires auth — call authenticate() first`)
      headers.authorization = `Bearer ${this.token}`
    }
    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
    if (!res.ok) throw new ApiError(res.status, path, await res.text())
    return (await res.json()) as T
  }

  // ── auth ─────────────────────────────────────────────────────────────

  /**
   * Runs the challenge/verify handshake and stores the bearer token.
   *
   * The API authenticates by signature: it issues a nonce message, the
   * account signs it, and the signature is exchanged for a JWT. The token is
   * held on this instance and attached to auth-gated calls automatically.
   *
   * @param address The authenticating account's address.
   * @param sign Signs the challenge message and returns an Aleo signature
   *   literal (`sign1…`) — e.g. wraps `account.signMessage`.
   * @returns The JWT, in case the caller wants to persist it.
   */
  async authenticate(address: string, sign: (message: string) => Promise<string>): Promise<string> {
    const challenge = await this.request<Schemas['ChallengeResponseDoc']>('POST', '/auth/challenge', {
      body: { address },
    })
    const signature = await sign(challenge.data.message)
    const verified = await this.request<Schemas['AuthTokenResponseDoc']>('POST', '/auth/verify', {
      body: { address, signature },
    })
    this.token = verified.data.token
    return this.token
  }

  /** Adopts a previously issued JWT (e.g. persisted from a prior session). */
  setToken(token: string): void {
    this.token = token
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
    return this.request('GET', `/pools/${encodeURIComponent(key)}/stats`)
  }

  /** Lists a pool's trades, optionally filtered by kind (paginated). */
  async getPoolTrades(
    key: string,
    query?: { limit?: number; offset?: number; trade_type?: string },
  ): Promise<Schemas['PoolTradesResponseDoc']> {
    return this.request('GET', `/pools/${encodeURIComponent(key)}/trades`, { query })
  }

  /** Reads OHLCV candles for a pool over a unix-seconds time range. */
  async getPoolOhlcv(
    key: string,
    query: { granularity: '1m' | '5m' | '15m' | '1h' | '4h' | '1d'; from: number; to: number },
  ): Promise<Schemas['OhlcvResponseDoc']> {
    return this.request('GET', `/pools/${encodeURIComponent(key)}/ohlcv`, { query })
  }

  // ── swaps & routing ──────────────────────────────────────────────────

  /** Lists a user's swap history (paginated; the API requires `user`). */
  async getSwaps(query: { user: string; pool?: string; limit?: number; offset?: number }): Promise<Schemas['SwapListResponseDoc']> {
    return this.request('GET', '/swaps', { query })
  }

  /** Reads one swap by id, with its hops and amounts. */
  async getSwap(swapId: string): Promise<Schemas['SwapResponseDoc']> {
    return this.request('GET', `/swaps/${encodeURIComponent(swapId)}`)
  }

  /**
   * Finds the best route between two tokens (BFS, ≤ 3 hops).
   *
   * Use the quoted output as `expectedOut` for `swapPrivate`'s slippage
   * math — a wrong quote only widens protection, never moves funds.
   */
  async getRoute(query: { token_in: string; token_out: string; amount_in?: bigint }): Promise<Schemas['RouteResponseDoc']> {
    return this.request('GET', '/route', {
      query: { token_in: query.token_in, token_out: query.token_out, amount_in: query.amount_in?.toString() },
    })
  }

  // ── positions & tokens ───────────────────────────────────────────────

  /** Lists a user's liquidity positions (paginated). */
  async getPositions(query: { user: string; limit?: number; offset?: number }): Promise<Schemas['PositionListResponseDoc']> {
    return this.request('GET', '/positions', { query })
  }

  /** Reads one position by its token id. */
  async getPosition(tokenId: string): Promise<Schemas['PositionResponseDoc']> {
    return this.request('GET', `/positions/${encodeURIComponent(tokenId)}`)
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
    return this.request('GET', '/balances', { query })
  }

  // ── protocol config ──────────────────────────────────────────────────

  /** Lists registered fee tiers with their tick spacings. */
  async getFeeTiers(): Promise<Schemas['FeeTierListResponseDoc']> {
    return this.request('GET', '/fee-tiers')
  }

  /** Lists registered tick spacings. */
  async getTickSpacings(): Promise<Schemas['TickSpacingListResponseDoc']> {
    return this.request('GET', '/tick-spacings')
  }

  /** Lists the on-chain operation schemas the API publishes. */
  async getTradingSchemas(): Promise<Schemas['TradingSchemaListResponse']> {
    return this.request('GET', '/schema/trading')
  }

  /** Reads one operation schema by id (e.g. `"swap"`). */
  async getTradingSchema(id: string): Promise<Schemas['TradingSchemaResponse']> {
    return this.request('GET', `/schema/trading/${encodeURIComponent(id)}`)
  }

  // ── utilities ────────────────────────────────────────────────────────

  /**
   * Starts a testnet faucet drop (1000 of each token) for an address.
   *
   * Asynchronous on the server: returns a `job_id` to poll with
   * {@link getAirdropStatus}. Used by the e2e to fund fresh accounts.
   */
  async airdrop(address: string): Promise<Schemas['AirdropStartResult']> {
    return this.request('POST', '/airdrop', { body: { address } })
  }

  /** Polls a faucet job until its per-token transfers complete. */
  async getAirdropStatus(jobId: string): Promise<Schemas['AirdropJob']> {
    return this.request('GET', `/airdrop/${encodeURIComponent(jobId)}`)
  }

  /** Raw on-chain pool introspection (slot + tick statuses) via the API. */
  async debugPool(query: { pool_key: string; ticks?: string }): Promise<Schemas['PoolDebugResponseDoc']> {
    return this.request('GET', '/debug/pool', { query })
  }
}
