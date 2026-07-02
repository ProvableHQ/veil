# Veil DEX Client Design Spec

A viem-like TypeScript interface for trading on the Aleo AMM, `shield_swap_v0_0_2.aleo`.
Provides composable read + write actions over the on-chain program and its off-chain
indexer API, usable directly as a regular TS API and exposed agent-first as MCP tools.

## Goals

- A small, composable DEX client that later layers (strategy testing, backtesting, live
  runners) can build on, inheriting viem-style composability for free
- Programmatic trades double as e2e tests against the live DEX program + indexer
- Private-by-default: V1 binds only the `*_private` program entrypoints
- One implementation, three surfaces: each action is a plain async TS function; the MCP
  tool and agent tool schema are thin wrappers over the same function with structured JSON
- Operate over the **deployed `.aleo` program** ABI, not the Leo source — Leo's
  `dyn record`, `IARC20@(...)` dispatch, and named structs do not exist at the deployed layer

## Non-Goals (V1)

- No public-visibility swap/liquidity entrypoints — private only
- No multi-hop swap *execution* — single-hop `swap_private` only; the `/route` read is
  exposed, but `swap_multi_hop_private` is deferred
- No `decrease_liquidity_private` — it does not exist on `feat/compliant-swaps`; deferred
  until it lands on this branch
- No concentrated-liquidity tick math *exposed to callers* — no range orders, no fancy math.
  (Caveat: `mint_private`/`increase_liquidity_private` *require* `tick_lower_hint`/
  `tick_upper_hint`, so the client computes them internally — see Tick hints. Swaps stay
  hint-free.)
- No strategy engine, backtester, or live runner — those build *on* this client later
- No proof generation — delegated to Veil's existing proving config

## Target contract & API

- Program: `shield_swap_v0_0_2.aleo` (Aleo testnet)
- Leo source (reference only): `ProvableHQ/amm-v3` @ `feat/compliant-swaps`
- Indexer API: `https://amm-api.dev.provable.com` (OpenAPI at `/openapi.json`)
- Reference derivation client: `ProvableHQ/amm-v3-tests` @ `feat/q128`,
  `src/client/amm-client.ts` (`deriveBlindingFactor`, `deriveBlindedAddress`)

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Application / Agent / Strategy (future)                       │
├──────────────────────────────────────────────────────────────┤
│  @veil/dex                                                     │
│    dexActions decorator  →  attach via client.extend()         │
│                                                                │
│    Reads (layered)                Writes (private)             │
│    ── chain-direct ──             swapPrivate  → swap_private    │
│    getPool / getSlot              claimSwapOutputPrivate         │
│    getSwapOutput                      → claim_swap_output_priv   │
│    isBlindedAddressUsed +         createPool   → create_pool     │
│    validation reads               mintPrivate  → mint_private    │
│    ── indexer (full REST) ──      increaseLiquidityPrivate       │
│    pools/tokens/positions/            → increase_liquidity_priv  │
│    swaps/trades/ohlcv/stats/      (method = camelCase of the     │
│    route/balances/fee-tiers/       snake_case transition)        │
│    tick-spacings/schema +         IndexerClient (auth, airdrop)  │
│    auth/airdrop/debug                                          │
│                                                                │
│    BlindedIdentity · SwapHandle · tick hints · record select   │
│    param helpers · derivation helpers                          │
│                                                                │
│    agent/  (tool schemas)   mcp/  (MCP tools)  — wrap actions   │
├──────────────────────────────────────────────────────────────┤
│  @veil/core                                                    │
│    PublicClient  (getMappingValue, readContract)               │
│    WalletClient  (executeContract / writeContract, proving)    │
│    requestRecords + pluggable scanner (account-type branched)  │
├──────────────────────────────────────────────────────────────┤
│  @veil/codegen (build step) → src/generated/shield_swap.ts     │
│    types + decoders from the deployed .aleo ABI                │
└──────────────────────────────────────────────────────────────┘
```

`@veil/dex` is a new sibling package to `@veil/bridge`. It depends on `@veil/core` and
adds no surface to core. Package layout mirrors core: `actions/`, `clients/decorators/`,
`agent/`, `mcp/`, `types/`.

## V1 Action Surface

### Writes (private only)

**Write methods are named after the transition, not re-aliased to a different concept — but in
idiomatic camelCase** (`client.swapPrivate(...)` calls the `swap_private` transition). It is a
1:1 case conversion, so the surface still maps directly to the program. (The snake_case string
is what's passed to the program; the camelCase name is the client method/file/function.)

| Method (camelCase) | `.aleo` entrypoint | Inputs (friendly → positional) |
|---|---|---|
| `swapPrivate` | `swap_private` | token_in record, (auto) blinding_factor, (auto) blinded_address, pool, zero_for_one, amount_in, amount_out_min, sqrt_price_limit, nonce, deadline, token0_id, token1_id |
| `claimSwapOutputPrivate` | `claim_swap_output_private` | (from handle) blinding_factor, blinded_address, swap_id, token_in, token_out; (from chain) amount_out, amount_remaining |
| `createPool` | `create_pool` | token0_program_id, token1_program_id, fee, initial_sqrt_price, tick_spacing, initial_tick (all public) |
| `mintPrivate` | `mint_private` | nonce, token0 record, token1 record, recipient, MintPositionRequest, token0_id, token1_id |
| `increaseLiquidityPrivate` | `increase_liquidity_private` | PositionNFT record, token0 record, token1 record, amount0_desired, amount1_desired, amount0_min, amount1_min, token0_id, token1_id, tick_lower_hint, tick_upper_hint |

The deployed ABI is **positional and unnamed** (`r0..rN`). A core value-add of the client is
mapping friendly named params → typed inputs, with correct types (snake_case wire format;
`number` for u8/u16/u32/i32, `bigint` for u64/u128; `string` for field/address). The struct/record
*types* are codegen-generated from the ABI; primitives are encoded by a thin `to*` util, the one
`MintPositionRequest` struct by a small formatter, and records pass through as
`OwnedRecord.recordPlaintext` (see Generated vs hand-written).

`dynamic.record` inputs (the swap `token_in` record; mint/increase token + `PositionNFT`
records) are obtained via core's `requestRecords` and passed through — never hand-decrypted
(see Records).

### Reads (layered)

**Chain-direct (trust-critical / money path)** — via core's `getMappingValue`:
- `getSwapOutput(swapId)` ← `swap_outputs` mapping; supplies `amount_out`/`amount_remaining`
  for the claim. Never trust the indexer for the amount being claimed.
- `isBlindedAddressUsed(addr)` ← `used_blinded_addresses` mapping; gates blinded-address
  selection (see Blinding lifecycle).
- `getPool(poolKey)` ← `pools` mapping; **static** config only: `token0`, `token1`, `fee`,
  `enabled`, `scale0`, `scale1` (token-ordering + decimal scales).
- `getSlot(poolKey)` ← `slots` mapping; **live** state: `sqrt_price`, `tick`, `liquidity`,
  fee growth, `next_init_below`/`next_init_above`. This — not `pools` — is the source of the
  current price/liquidity used to build swap params and `sqrt_price_limit`.
- Validation reads (pre-flight, prevent guaranteed-revert txs): `isPoolInitialized`
  (`initialized_pools`), `isFeeTierValid` (`fee_tiers`), `isTickSpacingValid`
  (`tick_spacings`), `getFeeToTickSpacing` (`fee_to_tick_spacing`, the canonical tick_spacing
  bound to a fee — needed for `createPool`).

> **Correction:** an earlier draft put live price in `pools`. The contract splits static pool
> config (`pools`) from live state (`slots`); price/liquidity/tick live in `slots`.

**Record-derived (the caller's own holdings)** — via core's `requestRecords` + scanner
(account-type branched), not a mapping read:
- `getOwnBalances({ tokenIds? }): Promise<Record<tokenId, bigint>>` — requests the account's
  **unspent** token records, parses each plaintext for its token id + `amount`, and **sums per
  token**. Optionally filtered to `tokenIds` (e.g. a pool's two tokens). This is the user's
  *private* balance derived from records — distinct from the indexer's `getBalances(user)`,
  which returns public/authorized balances for any address. Pure read of owned records; may be
  enriched with `decimals`/`symbol` via `getTokens` for display.
  - Reads `amount`/token id from `recordPlaintext` on the SDK/local path; on the wallet path a
    privacy wallet may return only a granted `recordView` — parse from `recordView.fields` when
    plaintext is absent, and note the total is only as complete as the record/field grants
    allow (an ungranted `amount` can't be summed).
  - *Open detail (resolve at impl):* which program(s) to scan for token records — the ARC-20
    token registry vs. per-token programs — depends on the token model behind shield_swap's
    `dyn record` / `token_id` fields. Confirm during Phase 3.

**Indexer REST (full coverage)** — via a typed `IndexerClient` over
`amm-api.dev.provable.com` (base URL configurable; default points at the dev indexer).
The full surface, grouped:

*Pools & markets*
- `getPools({ limit, offset })` / `getPool(key)` — discovery, token metadata, current price
- `getPoolStats(key)` — 24h price/volume summary (`/pools/{key}/stats`)
- `getPoolTrades(key, { limit, offset, tradeType })` — trade history; `tradeType` ∈
  `swap|mint|burn|collect` (`/pools/{key}/trades`)
- `getPoolOhlcv(key, { granularity, from, to })` — candles; `granularity` ∈
  `1m|5m|15m|1h|4h|1d` (`/pools/{key}/ohlcv`)

*Swaps & routing*
- `getSwaps({ user, pool, limit, offset })` / `getSwap(swapId)` — swap history
- `getRoute({ tokenIn, tokenOut, amountIn })` — BFS route, ≤3 hops (read only in V1;
  multi-hop execution deferred)

*Positions & tokens*
- `getPositions(user, { limit, offset })` / `getPosition(tokenId)`
- `getTokens()` / `getToken(addr)` — `token_id` ↔ program id, decimals
- `registerToken({ address, name, symbol, decimals, wrapperProgram? })` — `POST /tokens`
  (auth-gated)
- `getBalances(user)` — per-token authorized on-chain balances (`/balances`)

*Protocol config*
- `getFeeTiers()` (`/fee-tiers`) / `getTickSpacings()` (`/tick-spacings`)
- `getTradingSchema()` / `getTradingSchema(id)` — on-chain operation schemas
  (`/schema/trading[/{id}]`); usable to cross-check our agent tool schemas

*Account / session & utilities*
- `auth.challenge(address)` (`POST /auth/challenge`) + `auth.verify(address, signature)`
  (`POST /auth/verify`) → JWT; the `IndexerClient` stores the bearer token and attaches it
  to auth-gated calls automatically
- `airdrop(address)` — testnet faucet, 1000 of each token (`POST /airdrop`); **async** — returns a
  `job_id`; used in e2e setup
- `getAirdropStatus(jobId)` — poll a faucet job (`GET /airdrop/{job_id}`) until complete
- `debugPool({ poolKey, ticks? })` — raw on-chain pool introspection (`/debug/pool`)

Each read documents its source. Being wrong on a discovery/indexer read is harmless;
trust-critical values (swap output, blinded-address usage) come from chain only.

## Blinding-factor lifecycle (core mechanism)

Private entrypoints are bound together by a **blinding factor** and a derived **blinded
address**. Both are deterministic, derived from the account's view key + a `counter`, and
must replicate the reference client byte-for-byte:

```
blinding_factor = Poseidon8([ programAddrField,
                              BLINDING_FACTOR_DOMAIN,
                              viewKeyField,
                              counterField ])

blinded_address = Address.fromGroup(
  Poseidon8.hashToGroup( bitPack252([ programAddrField,
                                      CLAIM_OR_SWAP_DOMAIN,
                                      signerField,
                                      blinding_factor ]) ))
```

- `programAddrField` = x-coordinate of the program address group element
- `viewKeyField` = view-key scalar reinterpreted as a base-field element
- `signerField` = x-coordinate of the signer address group element
- Domain constants are hardcoded in the program:
  - `BLINDING_FACTOR_DOMAIN`
  - `CLAIM_OR_SWAP_DOMAIN = 11835072102227764468342786961086432175093421716844963782363567713633field`
- The 252-bit `toBitsLe` / `fromBitsLe` repacking in `blinded_address` emulates
  `Plaintext::Array.toFieldsRaw` and is **load-bearing** — it gets dedicated unit tests
  against known-good vectors from the reference client.

**Counter selection (the layered read in action):** blinded addresses are single-use. To
pick one for a new swap, the client scans `counter = 0, 1, 2, …`, derives the blinded
address for each, and reads `used_blinded_addresses[addr]` on-chain, using the first unused
one. The counter is auto-managed; callers never see it unless they override.

A `BlindedIdentity` helper encapsulates derivation + counter scan, returning
`{ counter, blindingFactor, blindedAddress }`.

## Two-phase swap & the SwapHandle

A swap is **request → (chain computes output) → claim**, not atomic:

1. `swapPrivate(intent)` builds params (see helpers), auto-selects a `BlindedIdentity`,
   submits the `swap_private` transition, and returns a **`SwapHandle`**:
   `{ swapId, blindingFactor, blindedAddress, tokenIn, tokenOut, poolKey, amountIn }`
   — everything `claimSwapOutputPrivate` needs *except* the amounts. The handle is plain JSON and
   serializable, so a bot/strategy can persist it across the gap between the two transactions.
2. The request tx must **finalize** before its output is readable. The caller waits
   (`waitForTransaction`) then reads `getSwapOutput(swapId)` from chain to obtain
   `amountOut` / `amountRemaining` (poll: the mapping is absent until finalized — surface a
   structured "not yet finalized — retry" rather than a null).
3. `claimSwapOutputPrivate(handle)` builds and submits the `claim_swap_output_private` transition,
   issuing the output (and any refund) as private records to the signer.

Per decision, request and claim are **separate actions** — no auto-orchestrating `swap()`
wrapper in V1. The handle is the glue.

## Param helpers (deliberately un-fancy)

From a friendly intent `{ tokenIn, tokenOut, amountIn, slippage }`, using `getPool` (ordering)
+ `getSlot` (live `sqrt_price`):
- determine `zero_for_one` and the `token0_id` / `token1_id` ordering
- compute `amount_out_min` and `sqrt_price_limit` from current price + slippage tolerance
- `getDeadline(offset)` — `deadline` is a **block height** (current height + offset), not a
  timestamp; requires a chain read
- nonce generation — `swap_private` takes `u64`, `mint_private` takes `field`; fresh per call

No tick math, range orders, or multi-hop path *execution* are exposed (the `/route` read is
available, but V1 only executes single-hop). Just enough to make a single-hop swap safe.
Callers may pass raw `sqrt_price_limit` / `amount_out_min` to bypass the helper.

## Records (input acquisition)

Every `dynamic.record` input is obtained through core's `requestRecords` + pluggable scanner,
**account-type branched** (local account → scanner finds/decrypts; delegated/RPC → wallet
provides). The reference client's `extractPositionNFTFromOutputs` + manual `decryptFn` are
**out of scope** — we do not re-roll decrypt/extract.

`@veil/dex` adds only **record selection** on top of `requestRecords({ program, unspent })`:
- the `PositionNFT` record for a given pool/position (mint returns it; increase consumes it)
- unspent token records covering `amount_in` / `amount0_desired` / `amount1_desired`

**Two account paths (post PR #68 — wallet-adapter privacy).** The `InputRequest` / `uid` /
`RecordView` machinery is for **wallet-adapter (RPC) clients talking to a privacy-preserving
wallet**; SDK/Leo-based **local** clients don't use it. Concretely:
- **Local / SDK path (primary — programmatic trades, e2e, strategies):** unchanged. Records
  carry full `OwnedRecord.recordPlaintext`; inputs are Aleo-encoded strings; local proving.
  Local proving **rejects** `InputRequest` (`assertNoInputRequests`), which our string-encoded
  path satisfies naturally.
- **Wallet-adapter path:** a wallet may withhold full plaintext and return `uid` + a granted
  `recordView` instead. Record inputs are then passed as an `InputRequest` (`{ type: 'record',
  program, recordname, uid }`) and core/the wallet resolves them. We get this for free: action
  record/value params accept `value | InputRequest` (codegen already widens every slot;
  `getContract`/`writeContract` pass requests through — the non-request fast path encodes
  exactly as before), so **no separate code path** in `@veil/dex`. Record selection by `uid`
  and connect-time grants (`ConnectOptions.recordAccess`) are the dapp's concern, not core's.

## Tick hints (mandatory for liquidity)

`mint_private` / `increase_liquidity_private` require `tick_lower_hint` / `tick_upper_hint`,
and the contract asserts `hint.tick < target && hint.next > target` (the hint must be the
target tick's predecessor in the initialized-tick linked list). A `pickInsertHint(poolKey,
targetTick)` helper derives them from `slot.next_init_below` / `next_init_above`.

**Documented limitation (inherited from the reference):** it cannot walk *multiple*
intervening ticks, because that needs SDK-side BHP256 struct-hash parity the SDK does not
provide. V1 supports the common single-neighbor case and surfaces a clear error otherwise.
Swaps need no hints.

## Generated vs hand-written (codegen + reuse boundary)

| Concern | Source |
|---|---|
| Struct/record/mapping **types + decoders** (chain value → typed object) for the main DEX program(s) | **`@veil/codegen`** build step → committed `src/generated/` (follows `apps/loyalty-node` precedent). The **primary, typed source of truth**. |
| Runtime **fallback** for programs without generated bindings (e.g. the arbitrary token programs behind `dyn record` inputs) | **`getContract`** — auto-encodes native values at runtime, but returns **no compile-time types**; used only where a generated binding doesn't exist |
| **Input encoding** (typed params → execution) | thin hand-written util in `@veil/dex`: primitive `to*` formatters + the single `MintPositionRequest` struct formatter + record passthrough (`recordPlaintext` on the SDK path). Every shield_swap entrypoint is primitives + records with exactly one struct input, so this stays small. Params also accept `InputRequest` (wallet path) — passed through untouched to core; the non-request fast path encodes exactly as before. |
| Record decrypt/fetch | **core** `requestRecords` + scanner |
| Blinding derivation, `SwapHandle`, tick hints, record selection, helpers, typed action wrappers | **hand-written in `@veil/dex`**, typed against the generated bindings |

**ABI source for the build (implemented):** shield_swap is consumed as a **deployed** program.
The pinned ABI is generated by the **Leo CLI** — `scripts/regen-abi.sh` does `curl` the deployed
program → `jq -r .` decode → **`leo abi`** → committed `abi/shield_swap_v0_0_2.json`. No custom
`.aleo` parsing (the earlier hand-rolled extractor was removed). Because `leo abi` (4.2.0) emits
a newer nested-mode variant format, core's `parseAbi` was extended (backward-compatibly) to
accept it. The committed ABI is the reproducible build artifact; rerun `regen-abi.sh` when the
contract redeploys.

**Resolved (was a spike):** codegen today emits types + decoders only. For V1 that is enough —
`@veil/dex` types its actions against the generated struct/record types and does the small input
encoding itself. Extending codegen to emit typed per-transition encoders is a future
enhancement, not required here.

## Derivation helpers (strategy primitives)

A small set of **pure, stateless functions** over read outputs — no network I/O, no strategy
logic. They are the un-fancy math that nearly every strategy re-derives, exported so callers
compose strategies on top instead of re-implementing (and subtly mis-implementing) the
fixed-point conversions. They are not strategies and ship no loops, signals, or state.

| Helper | Inputs | Returns |
|---|---|---|
| `poolPrice` | `Slot.sqrt_price` + `Pool.scale0`/`scale1` + token decimals | human price (token1/token0 and inverse) |
| `priceImpact` | `Slot.liquidity` + `debugPool` ticks + `amountIn` + `zeroForOne` | expected out, effective price, impact (bps) |
| `portfolioValue` | `getBalances` result + per-token prices + decimals | total value in a chosen quote token |
| `feeAprEstimate` | `getPoolStats` volume + `getFeeTiers` + your liquidity share | rough fee APR |

Notes:
- `poolPrice` must match the program's fixed-point format exactly. The contract currently
  uses Q64-based math (`liquidity_math::Q64`) with a Q128 migration in flight
  (`feat/q128-math-migration`); the reference tests live on `feat/q128`. The helper is
  unit-tested against known-good vectors, like `BlindedIdentity` derivation.
- `priceImpact` reuses the contract's swap-step math as a read-only estimate; an
  approximation is acceptable and documented, since the on-chain swap is authoritative.
- The slippage → `amount_out_min` / `sqrt_price_limit` conversions live in the Param helpers
  section above; these derivation helpers compose with them.
- Each is a plain exported function. Where it makes sense (e.g. `poolPrice`), it also gets an
  agent/MCP surface; the rest are library primitives.

## Agent-first surface

Every action ships three ways from one definition:
- the plain async TS function (regular API — imported directly by dapps/strategies)
- an MCP tool (under `@veil/dex` `mcp/`) returning structured JSON
- an agent tool schema (under `agent/`) for tool-calling agents

Errors are structured and actionable (e.g. "blinded address exhausted", "swap output not yet
finalized — retry"). No forked logic between surfaces.

## Testing strategy

- **Unit:** `BlindedIdentity` derivation against known-good vectors from the reference
  client; `poolPrice`/param-helper math against vectors; codegen decoders against sample
  mapping values; `pickInsertHint` against crafted slot states.
- **E2E (the headline goal):** programmatic trades against the live testnet program +
  indexer — `airdrop → createPool → mintPrivate → increaseLiquidityPrivate → swapPrivate →
  getSwapOutput → claimSwapOutputPrivate` — asserting end-state balances/records. These live
  alongside the existing e2e demo pattern and run via `pnpm vitest run`.

## Open items / follow-ups

- `decrease_liquidity_private` once it merges to `feat/compliant-swaps` → completes the
  liquidity lifecycle.
- Multi-hop swaps (`swap_multi_hop_private`) + indexer `GET /route` routing.
- A convenience `swap()` that orchestrates request → poll → claim, built on the V1 primitives.
- Public-visibility variants, if ever needed.
