# @provablehq/veil-core

## 0.7.0

### Minor Changes

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

### Minor Changes

- 387a580: Add ARC-20/ARC-22 conformance actions (`isArc20`, `isArc22`, `checkArcConformance`, pure `checkProgramConformance`) and the `aleo_check_arc_conformance` agent tool.

  `parseProgram` now models the full snarkVM surface: `record`/`struct` declarations, `view` blocks, and every `ValueType` register variant (arrays incl. nested, external records/structs, futures, `dynamic.record`/`dynamic.future`). Breaking for code that constructs `Program` values by hand or reads register shapes: `Program` gains required `kind: 'program'`, `records`, `structs`, and `views` fields, and function inputs/outputs are now `ProgramRegister` — a `kind`-discriminated union where only plaintext registers carry `visibility`. Code that consumes `parseProgram()` output positionally (names, `hasFinalize`, mappings) is unaffected.

- bc51d70: Support array and struct values through the whole encode/decode chain: `encodePlaintextValue` encodes plain objects and arrays (including nesting, e.g. `[MerkleProof; 2]`) against ABI type descriptors, `encodeInputs` accepts them natively, record parsing handles array- and struct-valued fields bracket-aware, and codegen emits compiling element-wise decoders for array-typed record fields instead of the previous non-compiling fallthrough.
- bc51d70: Separate plaintext parsing from record parsing. Breaking — the loose/strict record parsers are removed.

  - **`parsePlaintextValue` + `parseRecord` replace `parseRecordPlaintext`/`parseRecordPlaintextLoose`.** Plaintext (literals, structs, arrays) parses into a `PlaintextValue`; records parse through `parseRecord`, which mirrors snarkVM's record grammar (owner, per-entry visibility, `_nonce`) instead of accepting both shapes loosely.
  - **Struct values are not records.** Generated struct decoders take a `StructValue` instead of a `RecordValue`, and struct-valued mapping reads decode as plaintext — no phantom owner/visibility metadata.
  - **Futures parse typed.** Transition outputs that are futures parse into `FutureValue`, and dynamic futures into their own `DynamicFutureValue`, instead of passing through as text.
  - `RecordValue.ownerMode` is renamed to `ownerVisibility`.

- bc51d70: Typed, null-honest mapping reads, decoded end-to-end from the ABI. Breaking — mapping reads that returned raw strings (typed `string` or `unknown`) now return `string | null` or a decoded value.

  - **Absence is `null`, never an error.** `readContract`/`readMapping` return `string | null` — the node answers `null` for a key that is not in the mapping (and for an unknown mapping or program), and a 404 means the request itself was malformed. Contract-instance read methods follow (`Promise<string | null>`), and 404s rethrow with the program/mapping context attached.
  - **`TransportError` carries `status` and `body`** so callers branch on structured fields instead of matching message strings.
  - **Codegen emits a value decoder per mapping** (`toSlotsMappingValue`-style): struct values guard the shape and delegate to the struct decoder; literal values decode through the strict `parseValue` with a declared-width check, so a malformed or wrong-width response throws instead of coercing silently. Generated factory read methods take native typed keys (encoded via `encodeValue`) and resolve to `Promise<Value | null>` instead of `Promise<unknown>`.
  - **`parseValue` recognizes `sign1...` signature literals** as `{ value, type: 'signature' }`.
  - Shield-swap read actions ride the generated decoders: u64-and-wider uint mapping values decode correctly (the old parser accepted only u8/u16/u32), malformed boolean values throw instead of reading as `false`, and flag reads treat absence as `false` in one place.

## 0.5.0

### Minor Changes

- Version alignment with the 0.5.0 release of the fixed Veil package group
  (agent skills + DEX API auth in `@provablehq/shield-swap-sdk`, FeeMaster
  fee payment in `@provablehq/veil-aleo-sdk`).

## 0.4.1
