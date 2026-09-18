import type {
  Client,
  ProvingConfig,
  RecordProvider,
  WalletActions,
} from '@provablehq/veil-core'
import type { ApiAuthConfig } from '@provablehq/sdk'

/**
 * Margin treated as expired ahead of a JWT's stated expiry.
 *
 * Matches the margin the Provable SDK applies internally, so both sides agree
 * on when a token is still usable.
 */
const EXPIRY_SKEW_MS = 5 * 60 * 1000

/**
 * Credentials for the legacy JWT model of the Provable API.
 *
 * Optional everywhere: the default gateway needs no consumer and mints no JWT.
 * A caller who targets a legacy gateway such as `api.provable.com` passes the
 * pair and the session mints short-lived JWTs from it at that gateway. Nothing
 * registers new consumers anymore. A provisioned key for the default gateway
 * goes through {@link ProvableKeyedAuth} instead.
 *
 * @property consumerId Consumer id. Forms the path segment when minting JWTs.
 * @property apiKey API key. Sent as `X-Provable-API-Key` on the mint.
 */
export type ProvableApiCredentials = {
  consumerId: string
  apiKey: string
}

/**
 * Persists Provable API credentials between runs.
 *
 * Implemented by the caller — a file, a keychain, `localStorage`, or a secret
 * manager are all valid. A session reads through `load` on first use and never
 * writes: nothing registers anymore, so `save` is only called by callers who
 * seed a store themselves.
 *
 * @property load Reads stored credentials, or `undefined` when none are held.
 * @property save Writes credentials. Only reached by a caller seeding the store.
 *
 * @example
 * const store: ProvableCredentialStore = {
 *   load: async () => JSON.parse(await readFile(path, 'utf8')).provableApi,
 *   save: async (c) => writeFile(path, JSON.stringify({ provableApi: c }), { mode: 0o600 }),
 * }
 */
export type ProvableCredentialStore = {
  load: () => Promise<ProvableApiCredentials | undefined> | ProvableApiCredentials | undefined
  save: (credentials: ProvableApiCredentials) => Promise<void> | void
}

/**
 * Builds a credential store that keeps credentials for the life of the process.
 *
 * The default when a client is given no credentials and no store. Suited to any
 * runtime, since it touches no storage.
 *
 * @param initial Optional credentials to start with, so a caller can seed the
 *   store from an environment variable.
 * @returns A store backed by a closure variable.
 *
 * @example
 * const store = memoryCredentialStore()
 * // or seeded:
 * const seeded = memoryCredentialStore({ consumerId, apiKey })
 */
export function memoryCredentialStore(
  initial?: ProvableApiCredentials,
): ProvableCredentialStore {
  let held = initial
  return {
    load: () => held,
    save: (credentials) => {
      held = credentials
    },
  }
}

/**
 * Provisioned-key authentication for the Provable API gateway.
 *
 * The keyed variant of the Provable SDK's `ApiAuthConfig`, derived rather
 * than restated so the two cannot drift — values of this type pass straight
 * into the SDK's `RecordScanner` and delegated proving as their `auth`
 * option, where the SDK applies the header default (`DEFAULT_API_KEY_HEADER`).
 *
 * The gateway is unauthenticated by default, so a key is optional. When an
 * operator hands one out, every request carries it verbatim in a header.
 * Nothing registers, persists, or refreshes, and a rejected request (401)
 * means the key is invalid or revoked — retrying cannot help, and only the
 * operator can issue a replacement.
 *
 * Mutually exclusive with the session options (`credentials`, `store`,
 * `username`, `session`): those belong to the legacy JWT model. Combining
 * them throws at construction.
 *
 * @example
 * const auth: ProvableKeyedAuth = { mode: 'api-key', value: process.env.PROVABLE_API_KEY! }
 */
export type ProvableKeyedAuth = Extract<ApiAuthConfig, { mode: 'api-key' }>

/**
 * A minted Provable API JWT and its expiry.
 *
 * Structurally identical to the Provable SDK's `JWTData` and
 * `RecordScannerJWTData`, so a value of this type passes directly as their
 * `jwtData` option.
 *
 * @property jwt The `Authorization` header value, verbatim as issued by the
 *   API (Bearer-prefixed).
 * @property expiration Expiry as milliseconds since the Unix epoch.
 */
export type ProvableJwt = {
  jwt: string
  expiration: number
}

/**
 * The consumers a session has been wired into.
 *
 * Reported by {@link authenticateProvableApi} so a caller can tell which paths
 * one client's session reaches.
 *
 * @property proving Whether a proving configuration carries this session.
 * @property recordScanning Whether a record provider carries this session.
 */
export type ProvableSessionConsumers = {
  proving: boolean
  recordScanning: boolean
}

/**
 * A Provable API session: the configured credentials plus a cached, refreshing JWT.
 *
 * Built by `createProvingConfig`, `createRemoteScanner`, and
 * `createAleoClient` from the credential options they are given — a caller
 * configures credentials and does not construct this directly. With a
 * credential pair and a legacy gateway to mint at, the session mints and
 * refreshes JWTs; otherwise it is inert, since the default gateway needs
 * nothing.
 *
 * @property registeredConsumer Always false; nothing registers anymore.
 * @property getCredentials Resolves the supplied or stored credentials, or
 *   `undefined` when the client holds none.
 * @property getJwt Returns a JWT valid for at least the expiry margin, minting
 *   or refreshing as needed, or `undefined` when there are no credentials, no
 *   legacy gateway to mint at, or the gateway answered the mint with 404.
 * @property consumers Which consumers carry this session. Advisory reporting;
 *   nothing reads it to make decisions.
 * @property attach Records that a consumer now carries this session. Called by
 *   the factories during wiring.
 */
export type ProvableSession = {
  registeredConsumer: () => boolean
  getCredentials: (options?: { username?: string }) => Promise<ProvableApiCredentials | undefined>
  getJwt: (options?: { forceRefresh?: boolean }) => Promise<ProvableJwt | undefined>
  consumers: ProvableSessionConsumers
  attach: (consumer: keyof ProvableSessionConsumers) => void
}

/**
 * Options for {@link registerProvableApi}.
 *
 * @property username Handle the retired flow registered under. Ignored.
 * @property baseUrl Ignored; kept so existing calls compile.
 * @property transport Ignored; kept so existing calls compile.
 */
export type RegisterProvableApiParameters = {
  username: string
  baseUrl?: string
  transport?: typeof fetch
}

/**
 * Options for {@link createProvableSession}.
 *
 * @property credentials Optional credentials to mint from. Take precedence
 *   over `store`, so an operator can inject a rotated pair without clearing
 *   persisted state first.
 * @property store Optional store to read credentials from. Never written.
 * @property username Ignored; nothing registers anymore.
 * @property baseUrl Optional root of a legacy gateway that serves `/jwts`,
 *   such as `https://api.provable.com`. Without it the session mints nothing,
 *   because the default gateway has no JWT route. The factories derive it from
 *   the prover or scanner URL the caller configured.
 * @property transport Optional fetch-compatible transport for the mint.
 *   Defaults to the global `fetch`. Applies when a caller intercepts or
 *   instruments HTTP — a proxy, a recorder, a test stub.
 */
export type CreateProvableSessionOptions = {
  credentials?: ProvableApiCredentials
  store?: ProvableCredentialStore
  username?: string | (() => string)
  baseUrl?: string
  transport?: typeof fetch
}

/**
 * Options for {@link authenticateProvableApi}.
 *
 * @property username Ignored; nothing registers anymore.
 * @property forceRefresh Mint a fresh JWT even when the cached one is still
 *   valid. Defaults to false. Applies when recovering from a rejected token.
 *   No effect without credentials.
 */
export type AuthenticateProvableApiParameters = {
  username?: string
  forceRefresh?: boolean
}

/**
 * Result of {@link authenticateProvableApi}.
 *
 * @property credentials The credentials the client was configured with, or
 *   `undefined` when it holds none.
 * @property expiration Expiry of the minted JWT, as milliseconds since the
 *   Unix epoch, or `undefined` when nothing mints one.
 * @property registered Always false; nothing registers anymore.
 * @property applied Which paths the client's session reaches. All false for a
 *   keyed client or a client built without a session.
 */
export type AuthenticateProvableApiReturnType = {
  credentials: ProvableApiCredentials | undefined
  expiration: number | undefined
  registered: boolean
  applied: ProvableSessionConsumers
}

/**
 * The Provable API authentication action, merged into a client by `extend`.
 *
 * @property authenticateProvableApi Resolves the client's Provable API session.
 */
export type ProvableApiActions = {
  authenticateProvableApi: (
    params?: AuthenticateProvableApiParameters,
  ) => Promise<AuthenticateProvableApiReturnType>
}

/**
 * A wallet client carrying the Provable API authentication action.
 *
 * Composed inside the client's action set rather than intersected onto
 * `WalletClient`, so a caller who extends further — adding DEX actions, for
 * example — keeps `authenticateProvableApi` in the resulting type. `extend`
 * carries forward only what sits in the action set, so an outer intersection
 * would be dropped on the next call.
 *
 * The wallet half is restated rather than derived. `Omit<WalletClient, keyof
 * Client>` reads better and was tried first, but `keyof Client` resolves to
 * `never` against core's built declarations — so the Omit keeps every base field,
 * violates the `Extended` constraint, and silently collapses to a type missing
 * every wallet action. It typechecks against core's source and fails only for
 * consumers, which is the worst place to find out.
 *
 * Keep this in step if core changes what a wallet client carries; a
 * `WalletClientActions` export from core would remove the duplication safely.
 */
export type ProvableWalletClient = Client<
  WalletActions & { recordProvider: RecordProvider | undefined } & ProvableApiActions
>

/**
 * A proving configuration carrying the Provable API session.
 *
 * `createProvingConfig` returns this shape. Core types `Client.proving` as the
 * bare {@link ProvingConfig} and never reads binding-specific fields — `url` and
 * `apiKey` already travel the same way — so the session rides along without a
 * core change, and {@link authenticateProvableApi} narrows to read it.
 *
 * @property session The session shared with record scanning, or `undefined`
 *   when the client was configured without credentials.
 * @property keyedAuth The provisioned-key auth the client was configured
 *   with, or `undefined` under the session model. Mutually exclusive with
 *   `session`.
 */
export type ProvingConfigWithSession = ProvingConfig & {
  session?: ProvableSession | undefined
  keyedAuth?: ProvableKeyedAuth | undefined
}

/**
 * Formerly registered a Provable API consumer. Now a no-op.
 *
 * The default gateway needs no consumer, and the legacy gateway issues no new
 * ones through this SDK. Resolves without contacting the network.
 *
 * @deprecated Consumer registration is retired. Remove the call; pass a
 *   consumer pair the caller already holds, or a provisioned key through
 *   `auth`.
 * @param params Ignored.
 * @returns `undefined`.
 *
 * @example
 * const credentials = await registerProvableApi({ username: 'my-bot-42' })
 * // credentials is undefined
 */
export async function registerProvableApi(
  params: RegisterProvableApiParameters,
): Promise<ProvableApiCredentials | undefined> {
  void params
  return undefined
}

/**
 * Mints a JWT for a consumer on the legacy gateway.
 *
 * The token arrives in the `Authorization` response header and its expiry in
 * the response body's `exp` claim, in seconds. Hits the network.
 *
 * @param credentials The consumer id and API key to authenticate the mint with.
 * @param baseUrl Root expected to serve `/jwts`.
 * @param transport Fetch-compatible transport for the request.
 * @returns The token and its expiry in milliseconds since the Unix epoch, or
 *   `undefined` when the root answers 404: that gateway has no JWT route, so
 *   requests go out unauthenticated, which is what such a gateway expects. A
 *   bad key or an unknown consumer is a 401 on the legacy gateway, never a
 *   404, so a bad pair still surfaces.
 * @throws When the mint returns any other non-2xx status, or when the response
 *   omits the authorization header or the expiry claim.
 */
async function mintJwt(
  credentials: ProvableApiCredentials,
  baseUrl: string,
  transport: typeof fetch,
): Promise<ProvableJwt | undefined> {
  const response = await transport(`${baseUrl}/jwts/${encodeURIComponent(credentials.consumerId)}`, {
    method: 'POST',
    headers: { 'X-Provable-API-Key': credentials.apiKey },
  })
  if (response.status === 404) return undefined
  if (!response.ok) {
    throw new Error(
      `Provable API JWT mint failed (HTTP ${response.status}): ${await response.text()}`,
    )
  }
  const header = response.headers.get('authorization')
  if (!header) {
    throw new Error('Provable API JWT mint response carried no authorization header.')
  }
  const body = (await response.json()) as { exp?: number }
  if (typeof body.exp !== 'number') {
    throw new Error('Provable API JWT mint response carried no exp claim.')
  }
  return { jwt: header, expiration: body.exp * 1000 }
}

/**
 * Builds a Provable API session that mints JWTs from the credentials it is given.
 *
 * Credentials come from `credentials` or, failing that, from the store. With a
 * pair and a `baseUrl` the session mints a JWT on first use and refreshes it
 * near expiry, single-flighting concurrent mints so a cold client that proves
 * and scans together mints once. Without either it is inert: `getJwt` resolves
 * to `undefined` and nothing is requested, because the default gateway needs
 * no token. A root that answers the mint with 404 has no JWT route — a devnode,
 * a self-hosted edge — and the session goes inert from then on rather than
 * failing a client that never needed a token. Nothing registers a consumer in
 * any case.
 *
 * @param options Credential source, legacy mint root, and transport.
 * @returns A session for `createProvingConfig`, `createRemoteScanner`, and
 *   `createAleoClient` to share.
 *
 * @example
 * const session = createProvableSession({
 *   credentials: { consumerId, apiKey },
 *   baseUrl: 'https://api.provable.com',
 * })
 * const jwt = await session.getJwt()
 */
export function createProvableSession(options: CreateProvableSessionOptions = {}): ProvableSession {
  const baseUrl = options.baseUrl
  const transport = options.transport ?? fetch
  const consumers: ProvableSessionConsumers = { proving: false, recordScanning: false }

  let credentials = options.credentials
  let credentialsInFlight: Promise<ProvableApiCredentials | undefined> | undefined
  let jwt: ProvableJwt | undefined
  let jwtInFlight: Promise<ProvableJwt | undefined> | undefined
  // Set once a mint answers 404: the root has no JWT route, so later calls
  // resolve undefined without asking again.
  let noJwtRoute = false

  function getCredentials(): Promise<ProvableApiCredentials | undefined> {
    if (credentials) return Promise.resolve(credentials)
    // Collapse concurrent reads so a cold prove and scan load the store once.
    credentialsInFlight ??= Promise.resolve(options.store?.load())
      .then((stored) => {
        credentials = stored
        return stored
      })
      .finally(() => {
        credentialsInFlight = undefined
      })
    return credentialsInFlight
  }

  function getJwt({ forceRefresh = false }: { forceRefresh?: boolean } = {}): Promise<ProvableJwt | undefined> {
    const stale = !jwt || Date.now() >= jwt.expiration - EXPIRY_SKEW_MS
    if (!forceRefresh && !stale) return Promise.resolve(jwt)
    // A forced refresh joins an in-flight mint rather than racing it, so a
    // burst of rejected calls still produces one replacement token.
    jwtInFlight ??= (async () => {
      if (!baseUrl || noJwtRoute) return undefined
      const resolved = await getCredentials()
      if (!resolved) return undefined
      jwt = await mintJwt(resolved, baseUrl, transport)
      if (!jwt) noJwtRoute = true
      return jwt
    })().finally(() => {
      jwtInFlight = undefined
    })
    return jwtInFlight
  }

  return {
    registeredConsumer: () => false,
    getCredentials,
    getJwt,
    consumers,
    attach: (consumer) => {
      consumers[consumer] = true
    },
  }
}

/**
 * Reads the Provable API session off a client's proving configuration.
 *
 * `createProvingConfig` attaches the session to the configuration it returns.
 * Core types `proving` as the bare interface and never reads binding-specific
 * fields — `url` and `apiKey` are already carried the same way — so the narrow
 * is safe and stays local to this accessor.
 *
 * @param client The client to read from.
 * @returns The session, or `undefined` when the client has no proving
 *   configuration or was configured without credentials.
 */
function getProvableSession(client: Client): ProvableSession | undefined {
  return (client.proving as ProvingConfigWithSession | undefined)?.session
}

/**
 * Resolves the Provable API session backing delegated proving and record scanning.
 *
 * With a credential pair aimed at a legacy gateway this mints the JWT eagerly,
 * so a bad key fails before a transaction is built, and reports the expiry.
 * Otherwise it is a no-op: the default gateway needs no token, so a keyed,
 * credential-less, or default-gateway client resolves immediately with no
 * expiry. Never throws for lack of a session, and never registers a consumer.
 *
 * @param client Any client.
 * @param params Optional forced refresh; `username` is ignored.
 * @returns The configured credentials or `undefined`, the JWT expiry or
 *   `undefined`, `registered` false, and which paths the session reaches.
 * @throws When a configured pair fails to mint.
 *
 * @example
 * const { expiration, applied } = await client.authenticateProvableApi()
 */
export async function authenticateProvableApi(
  client: Client,
  params: AuthenticateProvableApiParameters = {},
): Promise<AuthenticateProvableApiReturnType> {
  const session = getProvableSession(client)
  if (!session) {
    return {
      credentials: undefined,
      expiration: undefined,
      registered: false,
      applied: { proving: false, recordScanning: false },
    }
  }
  const credentials = await session.getCredentials()
  const minted = credentials ? await session.getJwt({ forceRefresh: params.forceRefresh }) : undefined
  return {
    credentials,
    expiration: minted?.expiration,
    registered: false,
    applied: { ...session.consumers },
  }
}

/**
 * Builds the Provable API auth decorator for `client.extend()`.
 *
 * `createAleoClient` applies this already. Applies directly when composing a
 * client by hand from `createWalletClient` and a proving configuration.
 *
 * @returns A decorator: pass it to `client.extend(...)`.
 *
 * @example
 * const client = createWalletClient({ account, transport, proving })
 *   .extend(provableApiActions())
 * await client.authenticateProvableApi()
 */
export function provableApiActions() {
  return (client: Client): ProvableApiActions => ({
    authenticateProvableApi: (params) => authenticateProvableApi(client, params),
  })
}
