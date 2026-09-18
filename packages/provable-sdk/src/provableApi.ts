import type {
  Client,
  ProvingConfig,
  RecordProvider,
  WalletActions,
} from '@provablehq/veil-core'
import type { ApiAuthConfig } from '@provablehq/sdk'

/**
 * Credentials a caller may still hold from the retired consumer model.
 *
 * Accepted everywhere they were before so existing configuration keeps
 * loading, but no longer exchanged for anything: the gateway needs no
 * consumer and mints no JWT. Pass a provisioned key through
 * {@link ProvableKeyedAuth} instead when the operator has issued one.
 *
 * @property consumerId Consumer id from the retired registration flow.
 * @property apiKey API key from the retired registration flow.
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
 * `username`, `session`): those belong to the retired consumer model.
 * Combining them throws at construction.
 *
 * @example
 * const auth: ProvableKeyedAuth = { mode: 'api-key', value: process.env.PROVABLE_API_KEY! }
 */
export type ProvableKeyedAuth = Extract<ApiAuthConfig, { mode: 'api-key' }>

/**
 * A Provable API JWT and its expiry.
 *
 * Structurally identical to the Provable SDK's `JWTData` and
 * `RecordScannerJWTData`. The gateway mints none, so a session never produces
 * one; the type remains for callers that inject a token from elsewhere.
 *
 * @property jwt The `Authorization` header value, Bearer-prefixed.
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
 * A Provable API session: the credential options a client was built with.
 *
 * Built by `createProvingConfig`, `createRemoteScanner`, and
 * `createAleoClient` from the credential options they are given — a caller
 * configures credentials and does not construct this directly. The session is
 * inert: the gateway needs no consumer and mints no JWT, so `getJwt` resolves
 * to `undefined` and `getCredentials` only reports what the caller supplied.
 *
 * @property registeredConsumer Always false; nothing registers anymore.
 * @property getCredentials Resolves the supplied or stored credentials, or
 *   `undefined` when the client holds none.
 * @property getJwt Resolves to `undefined`; the gateway has no JWT route.
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
 * @property credentials Optional credentials to report from `getCredentials`.
 *   Take precedence over `store`.
 * @property store Optional store to read credentials from. Never written.
 * @property username Ignored; nothing registers anymore.
 * @property baseUrl Ignored; kept so existing calls compile.
 * @property transport Ignored; kept so existing calls compile.
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
 * @property forceRefresh Ignored; there is no token to refresh.
 */
export type AuthenticateProvableApiParameters = {
  username?: string
  forceRefresh?: boolean
}

/**
 * Result of {@link authenticateProvableApi}.
 *
 * @property credentials The credentials the client was configured with, or
 *   `undefined` when it holds none. Nothing needs them.
 * @property expiration Always `undefined`; no JWT is minted.
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
 * @property authenticateProvableApi Reports the client's Provable API session.
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
 * The gateway needs no consumer, so there is nothing to register and nothing
 * to return. Resolves without contacting the network.
 *
 * @deprecated The consumer model is retired. Remove the call; pass a
 *   provisioned key through `auth` if the operator issued one.
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
 * Builds an inert Provable API session.
 *
 * Reports the credentials it was given, supplied directly or read from the
 * store, and nothing else: it never registers, never mints, and never touches
 * the network. Kept so the factories that share a session across proving and
 * scanning keep their shape.
 *
 * @param options Credential source to report from.
 * @returns A session for `createProvingConfig`, `createRemoteScanner`, and
 *   `createAleoClient` to share.
 *
 * @example
 * const session = createProvableSession({ store })
 * const jwt = await session.getJwt() // undefined
 */
export function createProvableSession(options: CreateProvableSessionOptions = {}): ProvableSession {
  const consumers: ProvableSessionConsumers = { proving: false, recordScanning: false }

  return {
    registeredConsumer: () => false,
    getCredentials: async () => options.credentials ?? (await options.store?.load()),
    getJwt: async () => undefined,
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
 * Reports the Provable API session backing delegated proving and record scanning.
 *
 * A no-op against the network: the gateway needs no consumer and mints no JWT,
 * so proving and scanning work without this call. It remains so existing
 * bootstrap code keeps running, and it reports which paths carry the client's
 * session and which credentials, if any, the client was configured with.
 *
 * @param client Any client. A keyed client or one built without credentials
 *   reports no session paths.
 * @param params Ignored.
 * @returns The configured credentials or `undefined`, no expiry, `registered`
 *   false, and which paths the session reaches.
 *
 * @example
 * const { applied } = await client.authenticateProvableApi()
 */
export async function authenticateProvableApi(
  client: Client,
  params: AuthenticateProvableApiParameters = {},
): Promise<AuthenticateProvableApiReturnType> {
  void params
  const session = getProvableSession(client)
  return {
    credentials: await session?.getCredentials(),
    expiration: undefined,
    registered: false,
    applied: session ? { ...session.consumers } : { proving: false, recordScanning: false },
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
