# @provablehq/shield-swap-sdk

## 0.6.0

### Minor Changes

- bc51d70: Add `getOwnedPositions` and `getOwnedPosition` read actions that enumerate the
  account's liquidity positions from its PositionNFT records, joined with
  on-chain mapping state and derived values (current token amounts, uncollected
  fees), plus matching `shield_swap_get_owned_positions` /
  `shield_swap_get_owned_position` agent and MCP tools and the
  `listPositionNFTs` record helper.
- bc51d70: Separate plaintext parsing from record parsing. Breaking — the loose/strict record parsers are removed.

  - **`parsePlaintextValue` + `parseRecord` replace `parseRecordPlaintext`/`parseRecordPlaintextLoose`.** Plaintext (literals, structs, arrays) parses into a `PlaintextValue`; records parse through `parseRecord`, which mirrors snarkVM's record grammar (owner, per-entry visibility, `_nonce`) instead of accepting both shapes loosely.
  - **Struct values are not records.** Generated struct decoders take a `StructValue` instead of a `RecordValue`, and struct-valued mapping reads decode as plaintext — no phantom owner/visibility metadata.
  - **Futures parse typed.** Transition outputs that are futures parse into `FutureValue`, and dynamic futures into their own `DynamicFutureValue`, instead of passing through as text.
  - `RecordValue.ownerMode` is renamed to `ownerVisibility`.

- bc51d70: Retarget the SDK to the `shield_swap.aleo` stack (core AMM, swap router, LP router, freezelist, multisig, and the token wrappers). Breaking, hard cutover — `shield_swap_v3.aleo` support is removed.

  - **Wrappers are hidden.** Callers name only tokens, amounts, and pools; the SDK resolves each token's wrapped-ness on chain (`from_wrapper_token_id`) and dispatches to `shield_swap.aleo` or the correct router transition internally. `swap`/`swapMultiHop` no longer take `tokenInProgram`.
  - **Q128.128 prices.** Tick and price math moved from Q64 to Q128.128 (`getSqrtPriceAtTickX128`, `getTickEstimateX128`, `U256` sqrt-price literals). `getSqrtPriceAtTick`/`MIN_SQRT_PRICE` and the `scale0`/`scale1` pool fields are gone.
  - **Immutable withdrawal address** is required on mint and fixed for the position's life; `collect` supports an owner distinct from the withdrawal address.
  - **Unified claim.** `claimSwapOutput` serves both single- and multi-hop swaps and routes the payout (wrapped vs plain) internally; `claimMultiHopOutput` is removed.
  - Token/balance reads follow the migrated API shape (`amm_token_program` + `underlying_program` + `underlying_token_id`, replacing `wrapper_program`); private-balance scans key on `underlying_program` and read `credits.aleo` `microcredits`.

- bc51d70: Typed, null-honest mapping reads, decoded end-to-end from the ABI. Breaking — mapping reads that returned raw strings (typed `string` or `unknown`) now return `string | null` or a decoded value.

  - **Absence is `null`, never an error.** `readContract`/`readMapping` return `string | null` — the node answers `null` for a key that is not in the mapping (and for an unknown mapping or program), and a 404 means the request itself was malformed. Contract-instance read methods follow (`Promise<string | null>`), and 404s rethrow with the program/mapping context attached.
  - **`TransportError` carries `status` and `body`** so callers branch on structured fields instead of matching message strings.
  - **Codegen emits a value decoder per mapping** (`toSlotsMappingValue`-style): struct values guard the shape and delegate to the struct decoder; literal values decode through the strict `parseValue` with a declared-width check, so a malformed or wrong-width response throws instead of coercing silently. Generated factory read methods take native typed keys (encoded via `encodeValue`) and resolve to `Promise<Value | null>` instead of `Promise<unknown>`.
  - **`parseValue` recognizes `sign1...` signature literals** as `{ value, type: 'signature' }`.
  - Shield-swap read actions ride the generated decoders: u64-and-wider uint mapping values decode correctly (the old parser accepted only u8/u16/u32), malformed boolean values throw instead of reading as `false`, and flag reads treat absence as `false` in one place.

### Patch Changes

- 1be5e13: Fix `ApiClient.authenticate()` for the DEX API's new auth contract: verify now sends `challenge_id` and signs the server-provided challenge message, and the session JWT is read from the `ss_access` cookie (with a body-token fallback for older servers). Redeem endpoints no longer return an upgraded token — the access grant is server-side. Integration tests accept a `VEIL_DEX_API_URL` override for local DEX stacks.
- Updated dependencies [387a580]
- Updated dependencies [bc51d70]
- Updated dependencies [bc51d70]
- Updated dependencies [bc51d70]
  - @provablehq/veil-core@0.6.0

## 0.5.0

### Minor Changes

- Agent skills for trading on Shield Swap: agent-agnostic runbooks and an
  idempotent bootstrap ship under `skills/` in the npm package — account
  setup with Provable API self-registration, invite/referral-code
  redemption, airdrop, private swaps (including concurrent), liquidity, and
  collection.
- DEX API auth flows: `authenticateApi()` on the composed client,
  `authenticateWithAccount`, session auto-renewal on 401, long-lived API
  tokens (`createApiToken`/`listApiTokens`/`revokeApiToken`), invite-code
  access (`getAccessStatus`/`redeemAccessCode`) and referral redemption
  (`redeemReferralCode`), plus agent tools for the whole flow.
- `resolveDexImports` builds the full imports map a write needs, including
  the DEX program's own static imports.
- Internal peer ranges widened from `workspace:*` (published as an exact
  pin) to `workspace:^`.

## 0.4.1

### Patch Changes

- c901a27: Add `derivePoolKey` and `deriveTickKey`: derive a pool or tick key locally from `(token0, token1, fee)` or `(pool, tick)` via BHP256 struct hashing, matching the contract byte-for-byte (the pool pair is sorted ascending), without a `getPools` network round trip. BHP256 hashing uses the optional `@provablehq/sdk` peer, loaded lazily on first call — read-only and wallet-backed paths never pull in the WASM SDK.
  - @provablehq/veil-core@0.4.1
