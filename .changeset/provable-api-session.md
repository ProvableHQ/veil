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
  return. `consumerId` is now optional on both scanners — but required alongside
  `apiKey` when no session supplies tokens, since a JWT is minted from the pair;
  an incomplete pair throws at construction rather than 401ing on the first scan.
- `username` on `createAleoClient`, choosing the name a consumer is registered
  under when one has to be. Used verbatim, so the consumer is identifiable;
  defaults to a name derived from the account address plus a random suffix.
  A taken name now fails with an error stating that credentials cannot be
  recovered from a username — the API has no endpoint that reads a consumer back
  and a duplicate registration returns nothing usable, so the stored key is the
  only copy.

The delegated-proving path also gains the 401 re-mint retry that only record
scanning had, and record scanning now replaces its token only when the token was
what the service rejected, rather than on every transient failure.

**`proverUrl` is now a base URL, and defaults.** Pass
`https://api.provable.com/prove` and the active network is appended, mirroring
`createRemoteScanner`'s `url`. Omit it under `mode: 'delegated'` and it falls back
to the new `DEFAULT_PROVER_URL` export — `provingMode` already defaulted to
`'delegated'`, so a client built without a prover used to construct fine and then
fail on its first write. Local proving still resolves no endpoint.

The base-URL shape is also a fix. Previously the network was baked into the value
the caller supplied, so `switchChain` left delegated proving pointed at the network
the client started from — and confirmation polling with it, since it read the
network the handle was loaded with rather than the one in force. Both now follow
the switch. A value that still carries a trailing `/mainnet` or `/testnet` is
re-targeted rather than doubled, so existing callers keep working, and
`ProvingConfig.url` reports the endpoint for the network currently in force rather
than echoing the input.

**Scanner `url` is optional too**, defaulting to the new `DEFAULT_SCANNER_URL`.
It was `createRemoteScanner`'s only required field, so that factory now takes no
arguments at all, and `createStandaloneScanner` needs only a view key. Together
with the credential store's in-memory default, a delegated client and its scanner
are buildable from nothing but a private key and a node URL.

In `@provablehq/veil-core`, `Client` takes an accumulating `extended` type
parameter, defaulting to `{}`, and `extend` returns
`Client<added & existing>` instead of `Client & extended`. Chained `extend` calls
previously dropped earlier layers from the type — a wallet client extended once
lost `writeContract` and `recordProvider` from its type, though not at runtime.
A decorator can now also build on the layer beneath it, and the new `Extended`
constraint stops a decorator from shadowing `request`, `transport`, or `uid`.
`PublicClient`, `WalletClient`, `TestClient`, and `BridgeClient` are expressed
through the parameter. Existing code needs no change: the parameter's default
makes a bare `Client` mean what it always did.
