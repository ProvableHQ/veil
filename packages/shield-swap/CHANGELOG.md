# @provablehq/shield-swap-sdk

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

- Updated dependencies [99defd6]
  - @provablehq/veil-core@0.7.1

## 0.7.0

### Minor Changes

- c2124ee: Reserve blinded identities through a store, and expose `resolveDexImports` as an action.

  Swaps that ran in parallel from one local account reverted on finalize. A swap is
  bound to a blinded identity, and the program asserts each blinded address appears
  in `used_blinded_addresses` only once. With no `blindedIdentity` passed, `swap` and
  `swapMultiHop` called `nextBlindedIdentity`, which scans for the first counter the
  chain does not carry — correct in sequence, wrong in parallel. Two concurrent swaps
  read the same unused counter and the second reverted, with nothing to see locally
  because at proving time the address genuinely was unused. Disjoint input tokens did
  not help: the identity is per account, not per token.

  `reserveBlindedIdentity` closes the window by recording a reservation before
  returning it, and never issuing a counter at or below one already stored — so an
  unconfirmed swap still holds its counter. It moves monotonically from the highest
  known counter, and skips any address the chain already carries, which recovers a
  store another process has moved past. An empty store scans from 0, so a lost store
  costs reads rather than correctness. Local accounts only: a wallet derives and
  tracks its own identities.

  Reservations persist through a `BlindedIdentityStore`.
  `memoryBlindedIdentityStore` is the default — enough to keep one process's
  concurrent swaps apart — and `fileBlindedIdentityStore` on the new
  `@provablehq/shield-swap-sdk/node` entry point persists them across restarts, which
  is what a bot or a test suite wants. Configure either with
  `shieldSwapActions({ blindedIdentities })`.

  `recordBlindedSwap` attaches a swap id to a reservation, and
  `syncBlindedIdentities` reconciles the store against the chain: `reserved` until
  the address appears on chain, then `swapped` while its output is unclaimed and
  `claimed` once the claim consumes it. That makes proceeds recoverable after a
  crash — an identity is otherwise unrecoverable, since it is derived rather than
  recorded anywhere the account can see.

  `resolveDexImports` is now on the client as `client.resolveDexImports()` alongside
  the standalone export, which is unchanged. Every write needs its result and it
  already took `(client, params)`, so the action form removes an import for callers
  who have a composed client.

  `reconcileSwapHistory` recovers a store's past. Blinded identities are derived
  rather than recorded, and a claim deletes the `swap_outputs` entry it settles, so
  the `claim_swap_output` call is the only public trace tying an identity to its
  swap — its inputs carry the blinded address, swap id, token pair, and amounts. The
  action walks that history through `getProgramCallsPaginated` and `getTransaction`,
  marks matched identities `claimed`, and returns what it found. It stops as soon as
  every identity is accounted for, so a current store costs one page, and reports
  `complete: false` when it hit `maxPages` with history left. Recommended once when
  adopting a store for an account that already has history; `syncBlindedIdentities`
  remains the cheap call for routine use. It cannot surface unclaimed swaps, which
  by definition have no claim call.

  Verified against live testnet: seeded with a blinded address from a real claim, it
  recovered the swap id, both token ids, and the amounts in two pages, and the
  recovered id reads `null` from `swap_outputs` — which is what a settled claim
  should look like.

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

- e93d7a3: Derive the DEX API host from the client's network.

  `DEFAULT_API_URL` shipped as `amm-api.dev.provable.com`, which indexes the
  pre-migration `shield_swap_v3.aleo`. Since #110 moved this SDK to
  `shield_swap.aleo`, that host serves pools which do not exist on the program the
  SDK reads and proves against — so pool discovery returned keys and every chain
  read of them came back `null`, surfacing as "pool does not exist" rather than as a
  misconfigured URL.

  The API is deployed per-network on separate hosts, so a single constant cannot be
  right for both. `shieldSwapActions` now derives it from the client's network —
  `mainnet` to `api.swap.shield.fi`, otherwise `api.testnet.swap.shield.fi` — and an
  explicit `api.baseUrl` still wins. `SHIELD_SWAP_API_URLS` and `defaultApiUrl()`
  are exported for callers constructing an `ApiClient` directly.

  The host resolves per request rather than at construction, so `switchChain`
  re-targets the API instead of leaving it on the network the client started from.
  `ApiClientOptions.baseUrl` accordingly accepts `string | (() => string)`, and
  `ApiClient.baseUrl` becomes a getter — still a readable string.

  `DEFAULT_API_URL` is deprecated and now points at the testnet host. It is removed
  in the next major; a caller who needs a specific network should use
  `defaultApiUrl(network)`.

  Three integration suites defaulted to `amm-api-staging.dev.provable.com`, which
  now returns 404 for everything. They default to the testnet host instead — with it,
  35 previously-failing live tests pass, including the route-quote test recorded as
  known-red.

- e93d7a3: Derive insert hints from the DEX API when the WASM peer is unavailable.

  `pickInsertHint` walks the contract's initialized-tick list, which needs
  `@provablehq/sdk` to hash each tick key. Without the peer it fell back to the
  slot's two neighbours — correct only for a target within one initialized tick of
  the current price, and wrong for anything further out, which finalize rejects at
  the caller's expense.

  The API already answers this exactly. `GET /pools/{key}/initialized-ticks` returns
  the pool's full sorted tick list, and its own description names the purpose:
  computing `tick_lower_hint` / `tick_upper_hint` for the AMM's hint-walk asserts.
  It is now exposed as `client.api.getInitializedTicks(poolKey)`, and
  `shieldSwapActions` supplies it to `pickInsertHint`, `mint`, and
  `increaseLiquidity` automatically — so a wallet-backed client with no WASM gets
  the exact predecessor instead of a guess. Verified against three live testnet
  pools: the API-derived predecessor matched the chain walk on every one.

  Three sources now, in descending order of authority: the contract's own list
  whenever the peer is present, the API list when it is not, and the slot's
  neighbours only when neither is available. The chain stays preferred because the
  API list is indexed from positions rather than read from the contract, so it can
  lag a position minted moments ago — and a stale hint costs a fee. A failing or
  unauthenticated API drops to the slot rather than failing the write.

  `mint` and `increaseLiquidity` accept `initializedTicks` for callers driving them
  outside the decorator.

- e93d7a3: Add `liquidityForAmounts`, the deposit-side inverse of `amountsForLiquidity`.

  The package could turn a liquidity figure into token amounts but not the reverse,
  which is the direction a depositor starts from: a caller holds two balances and
  wants to know what position they support. Without it, every caller had to invent a
  liquidity number and work forwards, and a figure that balances at one pool's price
  falls short at another — one side runs out and the mint reverts.

  `liquidityForAmounts` mirrors the contract's own derivation: at or below the range
  token0 binds, at or above it token1, and inside the range the shorter side governs,
  with the same branch boundaries as `amountsForLiquidity` (`price <= lower` counts as
  below). Every step floors, so the result is a lower bound — feeding it back through
  `amountsForLiquidity` with deposit-side rounding returns amounts that fit inside the
  originals, which is what keeps a mint from reverting for want of a base unit. That
  property is asserted across a sweep of ticks, range widths, and magnitudes rather
  than on a single case. It returns 0 when the amounts are dust for the range's width.

- cda4f20: Add `previewMint`, which answers what a mint would open before anything is signed.

  Everything needed to plan a deposit was already exported, but assembling it was
  left to the caller: read the slot, floor both bounds onto the pool's tick spacing,
  price them with `getSqrtPriceAtTickX128`, ask `liquidityForAmounts` what the
  budget backs, then run it back through `amountsForLiquidity` with deposit-side
  rounding to learn what the mint actually consumes. Six steps in a fixed order,
  where getting the rounding direction wrong on the last one costs a reverted
  transaction, and skipping the alignment on the second produces bounds the contract
  rejects outright.

  `previewMint(client, params)` composes exactly those primitives — it introduces no
  new math — and returns the aligned bounds, the resulting liquidity, the amounts
  each side gives up, and the pool state they were derived from. The range comes
  either from explicit ticks or from `rangePercent`, a half-width in percent of the
  pool's current price that defaults to 5, so a caller who thinks in "±5% around the
  market" does not have to convert to ticks. Bounds are reported after alignment,
  because that is the range the mint opens.

  Two things it reports that a caller would otherwise have to know to look for:
  `inRange`, since a position outside the active tick earns nothing and is funded
  from one side only, and `feeTierSpacing`, the spacing the `fee_to_tick_spacing`
  registry binds to the pool's fee — equal to the pool's own on a healthy pool, and
  a signal that the pool has drifted from its fee tier when it is not. The pool's
  spacing governs either way, because that is what `mint` aligns against.

  `liquidity` of 0 is a result, not an error: the budget backs nothing over that
  range, so a mint would cost a fee and open nothing.

- cda4f20: Give the Q128 position math options objects, and add `liquidityForAmount`.

  The math helpers took their arguments positionally, and the arguments are mostly
  same-typed bigints: `amountsForLiquidity(sqrtPrice, sqrtA, sqrtB, liquidity,
roundUp)`. Swapping the price for a bound type-checks and returns a plausible
  wrong answer — a position reported as one-sided when it straddles the price, or a
  deposit sized against the wrong end of its range. Nothing catches it.

  They now take objects with named fields, matching `feeGrowthInside`, which was
  already shaped that way, and the viem convention these packages otherwise follow:
  positional for one or two obvious arguments, an options object as soon as the
  arguments are confusable.

  ```ts
  const range = {
    sqrtPriceX128: slot.sqrt_price,
    sqrtLowerX128: getSqrtPriceAtTickX128(tickLower),
    sqrtUpperX128: getSqrtPriceAtTickX128(tickUpper),
  };
  const liquidity = liquidityForAmounts({ ...range, amount0, amount1 });
  const amounts = amountsForLiquidity({ ...range, liquidity, roundUp: true });
  ```

  Nothing breaks yet. `amountsForLiquidity`, `amount0DeltaX128`, `amount1DeltaX128`
  and `feeOwed` shipped in 0.6.0, so each keeps its positional form as a deprecated
  overload returning identical numbers, removed in the next major; a test asserts
  the two shapes agree, including the wrapping path in `feeOwed` where transposing
  the growth figures is the specific mistake the object form prevents.
  `liquidityForAmounts` was never released and takes the object form only.

  Also adds `liquidityForAmount`, which answers what ONE side alone supports.
  `liquidityForAmounts` takes two ceilings and lets the shorter one govern, which is
  right for "deposit what I have" and wrong for "deposit exactly this much of one
  token" — there, a short balance on the other side silently shrinks the position
  instead of reporting that it cannot be funded. Pair it with `amountsForLiquidity`
  to get the other side's minimum. It returns `0` when the price puts the named side
  out of use — above a range a position holds only token1, so token0 funds nothing —
  which is a different condition from "deposit more" and worth distinguishing.

  `liquidity.ts --increase` uses it: naming one amount now derives the other as the
  minimum that must accompany it, and fails with what is needed and what is held
  when the balance cannot cover it, rather than depositing a fraction of what was
  asked for.

- cda4f20: Recover abandoned swaps from chain, including their handles.

  `used_blinded_addresses` is written by `finalize_swap`, not by the claim — so an
  identity the chain reports used with no claim naming it is a swap that landed and
  was never collected, with its output still sitting in `swap_outputs`. Previously
  those were reported as unreachable, on the grounds that a claim needs the whole
  handle and only the process that made the swap held one.

  That was wrong. A swap request publishes almost everything a claim consumes:
  `pool`, `zero_for_one`, `amount_in`, `amount_out_min`, `sqrt_price_limit`,
  `nonce`, `deadline`, and both token ids are public inputs, and the swap id is a
  public output. Multi-hop publishes its `SwapHop` structs the same way. The one
  private piece is the blinding factor, and that is derived locally from the view
  key and counter — which the store already holds.

  So `reconcileSwapHistory` now reads swap requests as well as claims in the same
  walk, and rebuilds a claimable handle from each. It also records `soldAmountIn`,
  the figure no claim reports: a claim says what came back, only the request says
  what it cost.

  Verified by rebuilding a store from an empty file against 21 pages of testnet
  history: 36 identities recovered, 32 settled, and four abandoned swaps rebuilt and
  then claimed — 0.143939 USDCx and 4.068448 ALEO that had been sitting unclaimed,
  two of them multi-hop.

- cda4f20: Remove `SHIELD_WRAPPERS`, and with it a table that never had a caller.

  `SHIELD_WRAPPERS` named the three shield wrapper programs and the assets they
  wrap. It shipped in 0.6.0 with testnet's underlyings hardcoded — `USDCx` mapped to
  `test_usdcx_stablecoin.aleo` on every network, which is not the program that exists
  on mainnet. The apparent fix was to split it per network, and the docblock claimed
  the table was there because record selection needed an underlying program id before
  any network round-trip.

  That claim was false. Nothing in the SDK read the table, at any commit since it was
  introduced. Wrapped-ness and the underlying program come from the AMM's own
  `from_wrapper_token_id` mapping via `resolveTokenRoute`, which is what `swap` and
  `swapMultiHop` spend from; private balances come from the API registry's
  `underlying_program`. Both are per network by construction and cannot name a
  testnet program while pointing at mainnet. The table answered a question that was
  already answered, and answered it from a hand-maintained copy that could drift.

  Callers wanting the underlying for a token id should read it the way the actions
  do:

  ```ts
  const route = await client.resolveTokenRoute({ tokenId });
  if (route.wrapped)
    console.log(route.wrapperProgram, "→", route.underlyingProgram);
  ```

  Removing rather than deprecating a published export is a break, and it is one on
  purpose: a deprecation cycle would carry a symbol with no callers, whose only
  tests asserted its literals against themselves, through another release. Mainnet
  makes the drift concrete — mainnet runs two credits wrappers with confusable names,
  `shield_swap_arc20_credits.aleo` (the one the AMM registers and every live pool
  trades) and `arc20_wrapped_credits.aleo` (a bridge-family ARC-20 the AMM does not
  know), and a curated list is exactly the artifact that gets that pair wrong.

- 4be5291: Rename the DEX authentication action to `authenticateShieldSwap`.

  `authenticateApi` did not say which API it signs into, and that became ambiguous
  now that a client can also carry `authenticateProvableApi` from
  `@provablehq/veil-aleo-sdk` — two auth actions on one client, one naming its
  service and one not. The two are unrelated: this one signs a nonce with the
  account and yields a DEX session; the other exchanges a consumer key for a JWT
  covering delegated proving and record scanning.

  `authenticateApi` remains as a deprecated alias with identical behaviour and is
  removed in the next major, so upgrading this minor breaks nothing. Both names
  call the same function rather than one wrapping the other, so they cannot drift.

- cda4f20: Fix the units of the route quote, add `planSwap`, `parseUnits`, and `formatUnits`.

  `ApiClient.getRoute` typed `amount_in` as `bigint` and stringified it, implying the
  raw base units every other amount in this SDK uses. The endpoint wants a decimal
  string in the input token's units, and returns `estimated_amount_out` the same
  way. Measured against testnet: `amount_in=0.5` quotes `0.000268655644950769` ETH,
  while `amount_in=500000` — the base-unit form of the same half-token — quotes
  `1.030419082712717843`, which is the pool's whole depth.

  That is expensive rather than merely wrong. A caller who follows the type builds a
  slippage floor three orders of magnitude above any achievable fill, and the swap
  reverts on finalize with the fee consumed. It cost exactly that to find.

  `amount_in` is now `string`, documented as the one place the API departs from base
  units. The agent tool had the same defect twice over: its handler called `BigInt()`
  on the value, which throws on `'0.5'`, and its schema told agents to pass "raw base
  units (u128)" — the instruction that produces the revert. Both corrected.

  `parseUnits` and `formatUnits` convert either way, named after viem's helpers and
  parsing on the string because a double cannot hold 18 significant decimals.

  `planSwap` turns "sell this for that" into an executable plan: the route from the
  API, every hop's tradeability and liquidity checked on chain because the index can
  list a pool the contract refuses to trade, the quote in base units, a slippage
  floor, and the `imports` every hop needs — the thing callers most often get wrong
  on multi-hop. A missing quote yields a zero floor and says so, rather than
  inventing a guarantee.

  Verified live: 0.5 USDCx → 0.000268655644950769 ETH, claimed in the same run, the
  received amount matching the quote exactly.

- cda4f20: Move the trader scripts out of `@provablehq/shield-swap-sdk` and into a new
  `@provablehq/shield-swap-cli` package, which installs a `shield-swap` binary.

  The scripts previously shipped as raw TypeScript under `skills/scripts/` and ran
  with `npx tsx` from inside `node_modules`. They are now subcommands —
  `shield-swap setup`, `pools`, `balances`, `positions`, `swap`, `swap-concurrent`,
  `history`, `mint`, `liquidity`, `collect`, `liquidity-e2e` — compiled and
  typechecked like the rest of the workspace. `swap-history` is now `history`; every
  other name is unchanged, as are all flags and the `--execute` and `--json`
  contracts.

  The CLI is a separate install so a project that only needs the client does not
  pull it in: `@provablehq/shield-swap-sdk` no longer ships `skills/scripts/`, and
  its tarball carries only `dist` and the runbook markdown.

  Migrating: install `@provablehq/shield-swap-cli` and replace
  `npx tsx node_modules/@provablehq/shield-swap-sdk/skills/scripts/<name>.ts` with
  `shield-swap <name>` (`npx shield-swap <name>` for a project-local install), and
  import the session helpers from `@provablehq/shield-swap-cli/session` rather than by
  path. Invoke the binary rather than the package: `npx @provablehq/shield-swap-cli`
  resolves against the registry, so the version can change between two commands and
  it needs a network.

- c2124ee: Track blinded identities inside the swap actions when a store is configured.

  Reservation existed but had to be driven by hand — reserve, swap, record — and the
  default path still derived identities by scanning the chain, which is safe in
  sequence and reverts in parallel. `swap` and `swapMultiHop` now reserve before
  submitting and record the resulting handle after, and `claimSwapOutput` marks the
  identity claimed. Two concurrent `client.swap()` calls can no longer collide.

  Tracking follows the store. `shieldSwapActions` supplies an in-memory one when
  none is configured, so a composed client is concurrency-safe out of the box —
  without persistence, so a restart rescans the chain for its next counter and
  forgets any unclaimed swap. Configure `fileBlindedIdentityStore` for anything
  long-running. The standalone `swap(client, params)` tracks only when handed a
  store, so its behaviour is unchanged from before.

  Two per-call opt-outs, and no boolean flag to contradict the config: pass
  `blindedIdentity` to supply your own identity, or `blindedIdentities: undefined` to
  skip tracking for that call. Wallet accounts are untouched either way, since they
  derive identities the client never sees.

  Records now carry the whole handle, not just the swap id, because
  `claimSwapOutput` consumes a handle. That makes crash recovery real: a process can
  claim a swap it did not make. `SwapHandle` holds bigints and `JSON.stringify`
  throws on those, so handles persist through an explicit shape with decimal strings
  (`toPersistedHandle` / `fromPersistedHandle`) rather than a bigint reviver, which
  cannot round-trip — a string field of digits would come back a bigint.
  `recordBlindedSwap` accordingly takes `{ handle }` instead of
  `{ blindedAddress, swapId }`.

  Two deliberately asymmetric failure policies. A store write that fails _after_ a
  swap lands throws `SwapRecordingError` with the handle attached: the swap
  succeeded, so resubmitting would spend more input, but the swap id is knowable
  only at that moment — nothing on chain links an identity to its swap until a claim
  exists — so a swallowed failure means unclaimable proceeds. A store write that
  fails after a _claim_ warns and continues, because the funds have landed and
  `reconcileSwapHistory` can repair the record.

  `getUnclaimedSwaps` summarizes what a store is still owed: one entry per output
  still sitting in `swap_outputs`, per-token totals across both sides of every swap
  (the output token plus any unfilled input a claim refunds), and a handle rebuilt
  from the store so each entry can be claimed by a process that did not make the
  swap. It reads the mapping rather than trusting stored statuses, so an entry
  appears exactly when a claim would succeed. Identities the chain has consumed whose
  swap id was never recorded are reported separately as `unresolvable`, since nothing
  on chain locates their proceeds until a claim exists.

- e93d7a3: Return the true predecessor from `pickInsertHint`, and export the tick-list sentinels.

  `pickInsertHint` read only `slot.next_init_below` / `next_init_above`, which
  bracket the pool's _current_ tick rather than the target. Any position bound
  further out than one initialized tick therefore got a hint above itself, which the
  contract rejects on finalize — the transaction is mined, reverts, and consumes the
  fee. On a live ETH/USDCx pool at tick `-200996`, a lower bound of `-203230`
  returned `-200996`; the correct predecessor is `-273894`. The docblock carried this
  as a known limitation with an exact walk listed as a follow-up. This is that
  follow-up: it now walks the initialized-tick list, which holds one entry per
  initialized tick — 3 to 18 on live pools — so the added reads are few and bounded.

  `MIN_TICK_SENTINEL` and `MAX_TICK_SENTINEL` are now exported. The list is anchored
  one step outside the usable range (`∓400_001`, against `MIN_TICK`/`MAX_TICK` of
  `∓400_000`), and with no constant for it callers hardcoded `-400001` — as the
  devnode lifecycle tests did, which works only for a pool whose tick list is still
  empty.

  Verified against every live testnet pool: 30 hints across 5 pools, each confirmed
  initialized, strictly below its target, and with its successor at or beyond the
  target.

### Patch Changes

- e93d7a3: Keep deriving the DEX API host when `baseUrl` is passed as `undefined`.

  `shieldSwapActions` built its `ApiClient` by setting the derived host and then
  spreading the caller's `api` options over it. A caller writing
  `baseUrl: process.env.VEIL_DEX_API_URL` with that variable unset passes the key
  with an `undefined` value, and the spread let it beat the derived host — after
  which `ApiClient` fell back to its deprecated testnet constant. A mainnet client
  would then read pools that do not exist on the program it proves against, with
  nothing in the configuration to suggest it. The coalesce is now applied after the
  spread, so only a `baseUrl` that is actually set overrides the derivation.

- e93d7a3: Document what a `null` `state` means on an owned position.

  `getOwnedPositions` and the README described it as a mint still finalizing, which
  covers one end of a position's life. The other end behaves the same way and was
  undocumented: the record scanner marks records spent on its own schedule, and was
  measured still serving a burned position more than four minutes after the burn
  confirmed. So a `null` state is equally a position that no longer exists, and a
  caller rendering a portfolio should treat it as "not a live position" rather than
  as a value still loading.

- e93d7a3: Keep `pickInsertHint` working without the optional WASM peer.

  Walking the initialized-tick list reads the `ticks` mapping, which is keyed by a
  hash of pool and tick — so it derives keys through `@provablehq/sdk`. `mint` calls
  `pickInsertHint` whenever hints are omitted, and `mint` deliberately uses the soft
  loader while `increaseLiquidity` never loads WASM at all, so making the hint walk
  require the peer broke wallet-backed browser installs that previously minted fine.
  That contradicted the design stated in `utils/sdk.ts`: read-only and wallet-backed
  paths never touch WASM.

  An absent peer now falls back to the slot's neighbours — one mapping read keyed by
  the pool, deriving nothing, and exactly what this returned before the walk existed.
  Callers with the peer keep the correct predecessor for any target; callers without
  it are no worse off than before. The fallback is best-effort, correct only for a
  target within one initialized tick of the current price, so a wallet-backed caller
  needing a distant range should pass `tickLowerHint` and `tickUpperHint` explicitly.

- Updated dependencies [e93d7a3]
- Updated dependencies [4be5291]
  - @provablehq/veil-core@0.7.0

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
