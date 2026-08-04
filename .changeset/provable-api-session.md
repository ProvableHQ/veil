---
'@provablehq/veil-core': minor
'@provablehq/veil-aleo-sdk': minor
---

Add Provable API authentication to `@provablehq/veil-aleo-sdk`, and make `Client` carry the actions layered onto it.

`createAleoClient` now builds a single Provable API session from its credential
options and shares it across delegated proving and record scanning, so one
credential mints one JWT rather than each service minting its own. The returned
wallet client carries `authenticateProvableApi()`, which resolves that session —
registering a consumer when none is configured — and reports the credentials, the
token expiry, whether a consumer was registered, and which paths the session
reaches.

New in `@provablehq/veil-aleo-sdk`:

- `registerProvableApi({ username })` — registers a consumer and returns its id
  and API key. The key is issued once, so persist it.
- `createProvableSession({ credentials | store, username })` — a session that
  caches its JWT, refreshes inside a five-minute expiry margin, and collapses
  concurrent mints onto one request.
- `authenticateProvableApi(client, params?)` and `provableApiActions()` — the
  action and its decorator.
- `ProvableCredentialStore`, with two implementations. `fileCredentialStore(path)`
  from the new `@provablehq/veil-aleo-sdk/node` subpath persists to JSON at mode
  `0600`, so a process registers on first run and reuses the consumer afterward;
  it lives behind a subpath so `node:fs` never reaches a browser bundle.
  `memoryCredentialStore()` holds credentials for the life of the process and is
  the default when a client is given neither credentials nor a store, so delegated
  proving works unconfigured — but a consumer registered there is lost at exit,
  and the API issues each key once, so anything long-lived wants persistence. An
  explicit `consumerId`/`apiKey` pair takes precedence over a store, so a rotated
  key needs no state reset.
- `session` on `createProvingConfig`, `createRemoteScanner`, and
  `createStandaloneScanner`, and `setSession` on the providers the first two
  return. `consumerId` is now optional on both scanners.

The delegated-proving path also gains the 401 re-mint retry that only record
scanning had, and record scanning now replaces its token only when the token was
what the service rejected, rather than on every transient failure.

**`proverUrl` is now a base URL.** Pass `https://api.provable.com/prove` and the
active network is appended, mirroring `createRemoteScanner`'s `url`. Previously
the network was baked into the value the caller supplied, so `switchChain` left
delegated proving pointed at the network the client started from — and
confirmation polling with it, since it read the network the handle was loaded
with rather than the one in force. Both now follow the switch. A value that still
carries a trailing `/mainnet` or `/testnet` is re-targeted rather than doubled, so
existing callers keep working; `ProvingConfig.url` reports the resolved endpoint
for the network currently in force rather than echoing the input.

In `@provablehq/veil-core`, `Client` takes an accumulating `extended` type
parameter, defaulting to `undefined`, and `extend` returns
`Client<added & existing>` instead of `Client & extended`. Chained `extend` calls
previously dropped earlier layers from the type — a wallet client extended once
lost `writeContract` and `recordProvider` from its type, though not at runtime.
A decorator can now also build on the layer beneath it, and the new `Extended`
constraint stops a decorator from shadowing `request`, `transport`, or `uid`.
`PublicClient`, `WalletClient`, `TestClient`, and `BridgeClient` are expressed
through the parameter. Existing code needs no change: the parameter's default
makes a bare `Client` mean what it always did.
