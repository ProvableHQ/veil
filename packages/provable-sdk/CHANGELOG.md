# @provablehq/veil-aleo-sdk

## 0.10.1

### Patch Changes

- caf4425: Default every hosted endpoint to the `edge.provable.com/api` gateway: the delegated prover, the record scanner, the React hook's node URL, and the shield-swap CLI's network URL. The gateway is unauthenticated and needs no consumer or JWT, so a client built from a private key and a network URL proves and scans out of the box; a provisioned key still goes through `auth`. The legacy JWT model stays supported for a caller who points the client at a legacy gateway: with `proverUrl` or the scanner `url` on `https://api.provable.com/...` and a `consumerId` + `apiKey` pair (or a `credentialStore`), a session mints at that gateway's `/jwts` and injects the token. On the default gateway the pair is carried and nothing mints. Consumer registration is retired: `registerProvableApi` is a no-op that resolves `undefined`, `username` is ignored, and a client without a pair never registers one. `authenticateProvableApi` no longer throws on a keyed or credential-less client; it resolves with `registered: false` and, without a pair, no `credentials` and no `expiration`. Bumps `@provablehq/sdk` to 0.11.10, which makes the same default change in the underlying SDK.

## 0.10.0

### Minor Changes

- ca51d13: Replace flat executor and RPC configuration with registry-keyed EVM, Solana,
  and Aleo clients. Add browser-wallet, viem-client, and local-key adapters,
  live Solana fee and rent reads, and expiry-aware confirmation. Every client
  has a public client by default, while wallet actions require the optional
  wallet client explicitly in their signatures. Fund-moving actions expose optional
  compact, versioned checkpoint hooks. Local Aleo flows checkpoint fully proved
  transactions before source or destination broadcast; other wallet APIs
  checkpoint submitted identifiers. Checkpoints exclude private-mint secrets.
  The read-only `recover({ checkpoint })` action returns an explicit `wait`, `resume`,
  `complete`, `done`, or `failed` next step without resubmitting funds. Each bridge decorator action now has its own module,
  with protocol mechanics isolated behind internal helpers. Call builders compute
  wallet inputs without network access and remain standalone utilities rather
  than bridge client methods. Resuming a confirmed xReserve approval now fails
  before another wallet request when its allowance is no longer available.
  Registry discovery is available directly through `registry.getAssets` and
  `registry.getRoutes`.
  The protocol-neutral lifecycle is now `quote`, `execute`, `getStatus`, `wait`,
  `recover`, `resume`, and `complete`. `quote` selects structured source and
  destination assets with an optional `bridgeProtocol` constraint, returns the
  validated plan with live costs, and replaces the separate preparation action.
  `wait` accepts optional stopping statuses, replacing `waitForStatus`. Encoded
  route ids are outputs rather than caller input. Private inbound
  xReserve transfers expose an explicit destination-action state, and `complete`
  submits exactly one caller-authorized Aleo mint. Native Veil wallet clients pass
  directly to `createAleoClient`, while protocol-specific escape hatches remain
  exported under the `hyperlane` and `xreserve` namespaces.
  Quoting and execution dispatch from the prepared route, replacing chain- and
  protocol-specific client methods and the longer transfer-suffixed names.
  Add deterministic recovery journeys and independently gated, minimum-amount
  mainnet suites for xReserve and Hyperlane routes using local accounts.
  Include Solana rent in executable quotes, expose honest Aleo Hyperlane fee
  limits, enforce the xReserve withdrawal fee, and verify Aleo-origin delivery
  from configured destination clients. Hyperlane inbound waits now verify the
  message id against the destination Aleo Mailbox `deliveries` mapping instead
  of treating an explorer index as canonical. Solana submissions align blockhash
  reads and transaction preflight at confirmed commitment, and expiry checks use
  canonical blockhash validity instead of provider-reported block heights. Add proving lifecycle events to core and
  make delegated `writeContract` proving return an unbroadcast transaction for
  the configured Aleo transport to submit. Delegated FeeMaster payment now
  defaults to disabled and must be opted into explicitly.
  Export `DEFAULT_SOLANA_RPC_URL` for the official Solana mainnet endpoint.
  Rewrite every bridge example and the Solana deposit operator script around the
  structured route and recoverable lifecycle APIs, with application-owned optional
  checkpoint persistence and no imports from protocol-internal utilities.
  Use visible minimum transfer amounts and fixed execution defaults in the bridge
  examples, and document the complete lifecycle in a tutorial with runnable route
  commands and recovery guidance.
  Teach client construction, planning, quoting, execution, and recovery beside the
  corresponding example code. The Aleo-to-Ethereum xReserve example now stops at
  the supported source-confirmation boundary instead of attempting unsupported
  destination delivery polling.
  Rewrite bridge action documentation around the caller's cross-chain lifecycle,
  including when funds move, when wallet authorization is required, which calls
  contact networks or providers, and what recovery information applications own.
  Document helper side effects and annotate protocol encodings, authorization
  boundaries, irreversible submissions, provider handoffs, and retry-safe
  recovery behavior for maintainers and independent implementations.
  Revamp every bridge example comment around the caller-visible transfer outcome,
  custody changes, wallet boundaries, settlement authority, and safe recovery after
  an uncertain post-broadcast result. Provider-managed xReserve mint examples now
  stop at the attestation boundary instead of waiting for an unverifiable delivery.

### Patch Changes

- ca51d13: Surface rejected delegated-prover broadcasts immediately instead of polling transactions that never entered the network.

## 0.9.0

## 0.8.0

## 0.7.1

### Patch Changes

- Add provisioned-key auth for the edge Provable API gateway.

  The edge gateway (edge.provable.com) has no consumer registration or JWT
  minting: operators hand out API keys and every request carries the key
  verbatim in an `X-API-Key` header. A `ProvableKeyedAuth` option — the api-key
  variant of the Provable SDK's `ApiAuthConfig` — is now accepted by
  `createProvingConfig`, `createRemoteScanner`, `createStandaloneScanner`, and
  `createAleoClient`.

  The keyed model is mutually exclusive with the consumer lifecycle: combining
  `auth` with `apiKey`, `consumerId`, `username`, `credentialStore`, or
  `session` throws at construction, a keyed client builds no session,
  `authenticateProvableApi` refuses, and a 401 is terminal rather than retried.

  `registerProvableApi` and `mintJwt` also gained a fetch-compatible
  `transport` option instead of calling the global fetch directly. Requires
  `@provablehq/sdk` 0.11.8.

- 99defd6: Parameterize record scans with Record Scanning Service filters.

  `requestRecords` now accepts a nested `filter` carrying the service's row
  bounds — record type, producing function, commitment, and block range — plus
  pagination, so a scan returns only the records a caller asked for. A local
  account pushes the bounds to the service; a wallet (RPC) account cannot
  forward them, so Veil applies the same bounds to what the wallet returned.

  `program` is now optional. Omitting it scans every program the account holds
  records for. A wallet (RPC) account still requires it and throws when it is
  absent, since the wallet-adapter protocol has no all-programs record request.

  **Behavior change:** `statusFilter: 'all'` — the default — previously returned
  unspent records only. It sent `unspent: true`, which the service reads as
  `spent = false`, making `'all'` behave identically to `'unspent'`. The key is
  now omitted for `'all'`, so it returns both spent and unspent records as
  documented. Code that relied on the default to get spendable records should
  pass `statusFilter: 'unspent'` explicitly.

  Pagination was previously unreachable while the service clamps results to 1000
  per page, so an account holding more matching records lost the remainder with
  no signal. `resultsPerPage` and `page` now reach the service.

  A filter bound can only be evaluated against a field a record carries. A
  privacy-preserving wallet omits fields withheld under a `recordAccess` grant,
  so a bound on a withheld field matches nothing rather than being ignored —
  filter on granted fields, or scope with `program`, which every path carries.

## 0.7.0

### Minor Changes

- cda4f20: Bump `@provablehq/sdk` to `^0.11.6`.

  0.11.6 adds a consensus version, so the devnode height lists grow from 17
  entries to 18. Both must match the SDK's count exactly and mirror each other —
  `DEVNODE_CONSENSUS_HEIGHTS` in `@provablehq/veil-aleo-sdk` and the
  `CONSENSUS_VERSION_HEIGHTS` default in `@provablehq/veil-aleo-devnode`. A short
  list panics with an opaque wasm `unreachable`.

  The `aleo-devnode` binary now comes from the `@provablehq/aleo-devnode` npm
  package rather than a GitHub release, so `pnpm install` provides it and the
  version is pinned in `package.json` like any other dependency. `startDevnode`
  still resolves it from `PATH` and still accepts `devnodePath`, so nothing
  changes for a consumer pointing at their own build.

- e93d7a3: Expose `confirmationTimeout` on `createAleoClient`.

  `createProvingConfig` accepted it but `createAleoClient` did not forward it, so a
  caller using the convenience factory was fixed at the default and had to compose the
  proving config by hand to change it. Multi-hop swaps exceed that — one
  measured at 322 seconds against a 300-second limit, surfacing as a timeout on a
  transaction that was still pending and would confirm.

- e93d7a3: Shorten the confirmation window to one minute, and report what the polls saw.

  `waitForConfirmation` defaulted to 300 seconds. Measured against the live testnet
  deployment, healthy confirmations land far inside that — a mint took 49.7s and an
  increase 39s, both including proving — so a transaction still absent at the limit
  is more often one the node never included than one about to arrive. The default is
  now 60_000, and callers on a congested network or a slower path raise it per client.

  This is a behaviour change: a write that previously confirmed between one and five
  minutes now throws `TransactionTimeoutError` instead of returning. Multi-hop swaps
  are the known case — one was measured at 322 seconds — and a client submitting them
  should set `confirmationTimeout` explicitly (around `400_000`) rather than take the
  default. The shield-swap README and the `createProvingConfig` reference both say so
  on the multi-hop path.

  The timeout error also reports what the polls observed. Every polling failure was
  previously swallowed, so a node that answered cleanly and consistently did not have
  the transaction was indistinguishable from one that could not be reached — and the
  message asserted the transaction "may still be pending", which is exactly backwards
  for a transaction that was dropped before inclusion. `TransactionTimeoutError` now
  carries `polls` and `absentPolls`, and its message states which case it saw. It does
  not diagnose why: the confirmed-transaction endpoint cannot tell a pending
  transaction from a dropped one on its own, so the message reports the observation
  and leaves the conclusion to the caller.

- 4be5291: Add Provable API authentication to `@provablehq/veil-aleo-sdk`, and make `Client` carry the actions layered onto it.

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

## 0.6.0

### Patch Changes

- Updated dependencies [387a580]
- Updated dependencies [bc51d70]
- Updated dependencies [bc51d70]
- Updated dependencies [bc51d70]
  - @provablehq/veil-core@0.6.0
  - @provablehq/veil-aleo-devnode@0.6.0

## 0.5.0

### Minor Changes

- `useFeeMaster` threads through `createProvingConfig` and
  `createAleoClient`, and defaults to true: the delegated prover pays
  transaction fees, so accounts holding no public credits can transact out
  of the box. Pass `useFeeMaster: false` when the account funds its own
  fees.
- Internal peer ranges widened from `workspace:*` to `workspace:^`.

## 0.4.1

### Patch Changes

- @provablehq/veil-core@0.4.1
- @provablehq/veil-aleo-devnode@0.4.1
