import type {
  Client,
  ProvingConfig,
  RecordProvider,
  WalletActions,
} from '@provablehq/veil-core'

/** Root of the hosted Provable API. Consumer and JWT endpoints sit here, not under the versioned path. */
const DEFAULT_PROVABLE_API_URL = 'https://api.provable.com'

/**
 * Margin treated as expired ahead of a JWT's stated expiry.
 *
 * Matches the margin the Provable SDK applies internally, so both sides agree
 * on when a token is still usable.
 */
const EXPIRY_SKEW_MS = 5 * 60 * 1000

/**
 * Credentials issued by the Provable API for a registered consumer.
 *
 * Authenticate delegated proving and the hosted Record Scanner Service. The
 * pair is minted by {@link registerProvableApi} and exchanged for short-lived
 * JWTs.
 *
 * @property consumerId Consumer id. Forms the path segment when minting JWTs.
 * @property apiKey API key. Returned once at registration and unrecoverable
 *   afterward, so a caller MUST persist it.
 */
export type ProvableApiCredentials = {
  consumerId: string
  apiKey: string
}

/**
 * Persists Provable API credentials between runs.
 *
 * Implemented by the caller — a file, a keychain, `localStorage`, or a secret
 * manager are all valid, and the choice belongs to the runtime rather than to
 * the SDK. A session reads through `load` on first use and writes through
 * `save` exactly once, immediately after registering a new consumer.
 *
 * @property load Reads stored credentials. Returning `undefined` means no
 *   consumer is registered yet and triggers registration.
 * @property save Writes credentials. The API key is unrecoverable if this
 *   write is lost, so a failure here should propagate rather than be swallowed.
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
 * The default when a client is given no credentials and no store, and the right
 * choice for tests and short-lived workers. Suited to any runtime, since it
 * touches no storage.
 *
 * A consumer registered into this store is lost when the process exits, and its
 * API key is issued once — so a process that registers here and runs again
 * registers a second consumer that nobody can reclaim. Anything longer-lived
 * than a single run belongs in a persistent store: `fileCredentialStore` from
 * `@provablehq/veil-aleo-sdk/node`, or a caller-supplied
 * {@link ProvableCredentialStore}.
 *
 * @param initial Optional credentials to start with, so a caller can seed the
 *   store from an environment variable and skip registration.
 * @returns A store backed by a closure variable.
 *
 * @example
 * const store = memoryCredentialStore()
 * // or seeded, in which case nothing registers:
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
 * one authentication call actually covers.
 *
 * @property proving Whether a proving configuration carries this session.
 * @property recordScanning Whether a record provider carries this session.
 */
export type ProvableSessionConsumers = {
  proving: boolean
  recordScanning: boolean
}

/**
 * A live Provable API session: consumer credentials plus a cached, refreshing JWT.
 *
 * Built by `createProvingConfig`, `createRemoteScanner`, and
 * `createAleoClient` from the credential options they are given — a caller
 * configures credentials and does not construct this directly. Sharing one
 * session across delegated proving and record scanning means a single minted
 * JWT and a single refresh policy for both.
 *
 * @property registeredConsumer Reports whether this session registered a new
 *   consumer rather than loading an existing one. Only meaningful after
 *   credentials have resolved.
 * @property getCredentials Resolves the credentials, registering on first use
 *   when neither direct credentials nor a store supply them.
 * @property getJwt Returns a JWT valid for at least the expiry margin,
 *   minting or refreshing as needed.
 * @property consumers Which consumers carry this session. Advisory reporting;
 *   nothing reads it to make decisions. `recordScanning` is set where a record
 *   provider is wired to a client, so sharing one session across several
 *   clients under-reports rather than claiming a path a given client lacks.
 * @property attach Records that a consumer now carries this session. Called by
 *   the factories during wiring.
 */
export type ProvableSession = {
  registeredConsumer: () => boolean
  getCredentials: (options?: { username?: string }) => Promise<ProvableApiCredentials>
  getJwt: (options?: { forceRefresh?: boolean }) => Promise<ProvableJwt>
  consumers: ProvableSessionConsumers
  attach: (consumer: keyof ProvableSessionConsumers) => void
}

/**
 * Options for {@link registerProvableApi}.
 *
 * @property username Handle for the consumer. Globally unique across the
 *   Provable API, so a taken name fails the call.
 * @property baseUrl Optional Provable API root. Defaults to
 *   `https://api.provable.com`. Applies when targeting a non-production
 *   deployment.
 */
export type RegisterProvableApiParameters = {
  username: string
  baseUrl?: string
}

/**
 * Options for {@link createProvableSession}.
 *
 * @property credentials Optional credentials to use directly. Take precedence
 *   over `store`, so an operator can inject a rotated or CI-provided pair
 *   without clearing persisted state first.
 * @property store Optional persistence for credentials across runs. Omit for a
 *   consumer that lives only as long as the process.
 * @property username Optional handle to register under when neither
 *   `credentials` nor `store` yields a pair. A function is called lazily, so a
 *   caller can derive the name from an account address that is not known at
 *   configuration time. Required only if registration may happen.
 * @property baseUrl Optional Provable API root. Defaults to
 *   `https://api.provable.com`.
 */
export type CreateProvableSessionOptions = {
  credentials?: ProvableApiCredentials
  store?: ProvableCredentialStore
  username?: string | (() => string)
  baseUrl?: string
}

/**
 * Options for {@link authenticateProvableApi}.
 *
 * @property username Optional handle to register under when the client's
 *   configuration yields no credentials. Overrides the name configured on the
 *   session.
 * @property forceRefresh Mint a fresh JWT even when the cached one is still
 *   valid. Defaults to false. Applies when recovering from a rejected token.
 */
export type AuthenticateProvableApiParameters = {
  username?: string
  forceRefresh?: boolean
}

/**
 * Result of {@link authenticateProvableApi}.
 *
 * @property credentials The resolved consumer credentials. Worth persisting
 *   when `registered` is true — the API key is unrecoverable afterward.
 * @property expiration Expiry of the minted JWT, as milliseconds since the
 *   Unix epoch.
 * @property registered Whether this call registered a new consumer rather than
 *   loading an existing one.
 * @property applied Which paths the session reaches. `recordScanning` is false
 *   when the client was given a record provider that cannot accept a session —
 *   any implementation other than the ones this package builds — in which case
 *   that provider keeps using the credentials it was constructed with.
 */
export type AuthenticateProvableApiReturnType = {
  credentials: ProvableApiCredentials
  expiration: number
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
 */
export type ProvingConfigWithSession = ProvingConfig & {
  session?: ProvableSession | undefined
}

/**
 * Registers a Provable API consumer and returns its credentials.
 *
 * Unauthenticated — this is the call that issues the credentials everything
 * else authenticates with. Hits the network. Usernames are globally unique, so
 * a collision surfaces as a failed call and needs a different name.
 *
 * @param params Handle to register under, and optionally a non-default API root.
 * @returns The consumer id and API key. The key is shown only here, so the
 *   caller MUST persist it.
 * @throws When registration returns a non-2xx status, or when the response body
 *   does not carry a consumer id and key.
 *
 * @example
 * const credentials = await registerProvableApi({ username: 'my-bot-42' })
 * await writeFile('creds.json', JSON.stringify(credentials))
 */
export async function registerProvableApi(
  params: RegisterProvableApiParameters,
): Promise<ProvableApiCredentials> {
  const baseUrl = params.baseUrl ?? DEFAULT_PROVABLE_API_URL
  const response = await fetch(`${baseUrl}/consumers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: params.username }),
  })
  if (!response.ok) {
    throw new Error(
      `Provable API consumer registration failed (HTTP ${response.status}): ${await response.text()}`,
    )
  }
  const body = (await response.json()) as { consumer?: { id?: string }; key?: string }
  if (!body.consumer?.id || !body.key) {
    throw new Error('Provable API consumer registration response carried no consumer id and key.')
  }
  return { consumerId: body.consumer.id, apiKey: body.key }
}

/**
 * Mints a JWT for a registered consumer.
 *
 * The token arrives in the `Authorization` response header and its expiry in
 * the response body's `exp` claim, in seconds. Hits the network.
 *
 * @param credentials The consumer id and API key to authenticate the mint with.
 * @param baseUrl Provable API root.
 * @returns The token and its expiry in milliseconds since the Unix epoch.
 * @throws When the mint returns a non-2xx status, or when the response omits
 *   the authorization header or the expiry claim.
 */
async function mintJwt(credentials: ProvableApiCredentials, baseUrl: string): Promise<ProvableJwt> {
  const response = await fetch(`${baseUrl}/jwts/${encodeURIComponent(credentials.consumerId)}`, {
    method: 'POST',
    headers: { 'X-Provable-API-Key': credentials.apiKey },
  })
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
 * Builds a Provable API session that resolves credentials and refreshes its JWT.
 *
 * Credentials resolve on first use — supplied directly, else loaded from the
 * store, else registered and saved. Registration and minting are each
 * single-flighted, so a cold client that proves and scans concurrently
 * registers once and mints once. Pure and local until the first
 * `getCredentials` or `getJwt` call.
 *
 * @param options Credential source, optional persistence, and the name to
 *   register under.
 * @returns A session for `createProvingConfig`, `createRemoteScanner`, and
 *   `createAleoClient` to share.
 *
 * @example
 * const session = createProvableSession({ store, username: 'my-bot-42' })
 * const { jwt } = await session.getJwt()
 */
export function createProvableSession(options: CreateProvableSessionOptions = {}): ProvableSession {
  const baseUrl = options.baseUrl ?? DEFAULT_PROVABLE_API_URL
  const consumers: ProvableSessionConsumers = { proving: false, recordScanning: false }

  let credentials = options.credentials
  let registered = false
  let credentialsInFlight: Promise<ProvableApiCredentials> | undefined
  let jwt: ProvableJwt | undefined
  let jwtInFlight: Promise<ProvableJwt> | undefined

  async function resolveCredentials(usernameOverride?: string): Promise<ProvableApiCredentials> {
    if (credentials) return credentials
    const stored = await options.store?.load()
    if (stored) {
      credentials = stored
      return credentials
    }
    const configured = typeof options.username === 'function' ? options.username() : options.username
    const username = usernameOverride ?? configured
    if (!username) {
      throw new Error(
        'No Provable API credentials available — pass credentials, a store holding them, or a username to register with.',
      )
    }
    const issued = await registerProvableApi({ username, baseUrl })
    // Persist before returning: the API key is issued once, so a failure
    // between registration and the write orphans the consumer.
    await options.store?.save(issued)
    credentials = issued
    registered = true
    return credentials
  }

  function getCredentials({ username }: { username?: string } = {}): Promise<ProvableApiCredentials> {
    // Collapse concurrent resolutions so a cold prove and scan register once.
    credentialsInFlight ??= resolveCredentials(username).finally(() => {
      credentialsInFlight = undefined
    })
    return credentialsInFlight
  }

  function getJwt({ forceRefresh = false }: { forceRefresh?: boolean } = {}): Promise<ProvableJwt> {
    const stale = !jwt || Date.now() >= jwt.expiration - EXPIRY_SKEW_MS
    if (!forceRefresh && !stale) return Promise.resolve(jwt!)
    // A forced refresh joins an in-flight mint rather than racing it, so a
    // burst of rejected calls still produces one replacement token.
    jwtInFlight ??= (async () => {
      const resolved = await getCredentials()
      jwt = await mintJwt(resolved, baseUrl)
      return jwt
    })().finally(() => {
      jwtInFlight = undefined
    })
    return jwtInFlight
  }

  return {
    registeredConsumer: () => registered,
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
 * Registers a consumer when the client's configuration yields none, mints a
 * JWT, and leaves both on the session the client's proving configuration and
 * record provider already hold — so proving and scanning authenticate from then
 * on without further setup. Optional: the first prove or scan resolves the same
 * session lazily. Calling it explicitly front-loads registration, surfaces
 * credential failures before a transaction is built, and returns a newly issued
 * API key at the one moment it is recoverable.
 *
 * Hits the network: registration on first run, plus one JWT mint.
 *
 * @param client A client whose proving configuration carries Provable API
 *   credentials or a credential store.
 * @param params Optional registration name and forced refresh.
 * @returns The credentials, the JWT expiry, whether a consumer was registered,
 *   and which paths the session reaches.
 * @throws When the client has no Provable API session configured, or when
 *   registration or minting fails.
 *
 * @example
 * const { credentials, registered } = await client.authenticateProvableApi()
 * if (registered) await store.save(credentials)
 */
export async function authenticateProvableApi(
  client: Client,
  params: AuthenticateProvableApiParameters = {},
): Promise<AuthenticateProvableApiReturnType> {
  const session = getProvableSession(client)
  if (!session) {
    throw new Error(
      'No Provable API session on this client — pass consumerId and apiKey, or a credentialStore, when creating it.',
    )
  }
  const credentials = await session.getCredentials({ username: params.username })
  const { expiration } = await session.getJwt({ forceRefresh: params.forceRefresh })
  return {
    credentials,
    expiration,
    registered: session.registeredConsumer(),
    applied: { ...session.consumers },
  }
}

/**
 * Builds the Provable API auth decorator for `client.extend()`.
 *
 * `createAleoClient` applies this already. Applies directly when composing a
 * client by hand from `createWalletClient` and a proving configuration built
 * with credentials.
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
