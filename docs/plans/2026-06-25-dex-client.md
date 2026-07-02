# Veil DEX Client (`@veil/shield-swap`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@veil/shield-swap` — a private-by-default, agent-first TypeScript client for the Aleo AMM `shield_swap_v0_0_2.aleo`, with composable read + write actions usable directly and as MCP/agent tools.

**Architecture:** A new package sibling to `@veil/bridge`, layered on `@veil/core`. Typed bindings for the main DEX program come from the `@veil/codegen` build step (committed `src/generated/`); `getContract` is the runtime fallback for programs without generated bindings (arbitrary token programs behind `dyn record` inputs). Chain-direct reads use core `getMappingValue` + generated decoders; the off-chain AMM REST API is wrapped by a typed `IndexerClient`. Records (token inputs, `PositionNFT`) come from core `requestRecords` + scanner, account-type branched. Each action is one async function exposed three ways (plain TS, MCP tool, agent schema).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), pnpm workspace, vitest, `@veil/core`, `@veil/codegen`, `@provablehq/sdk` (Poseidon8/Field/Scalar/Address for derivation), tsup (build).

**Reference spec:** `docs/specs/2026-06-24-dex-swaps-design.md` — read it before starting.

## Global Constraints

- **No AI attribution** in commits/PRs/code; **no `Co-Authored-By`** lines (CLAUDE.md).
- **Before committing code** run `/code-review` and `/simplify` and address findings (CLAUDE.md). Docs-only commits are exempt.
- **Wire types stay snake_case** to match the Provable API/`.aleo` format; SDK-facing param names may be camelCase, but anything serialized to the program is snake_case.
- **Numeric widths (codegen'd program bindings):** `number` for u8/u16/u32 (and i8/i16/i32); `bigint` for u64/u128 (and i64/i128). `string` for `field`/`address`/`scalar`/`group`. (u64 → `bigint`: mechanically-generated bindings can't assume small values — e.g. the swap nonce overflows 2^53.)
- **Private only (V1):** bind only `*_private` entrypoints; no public-visibility variants.
- **Exactly two signer paths, keyed by account type (post PR #68):** (1) **Wallet signers (Shield-like wallets ONLY)** — the `InputRequest` approach (what the amm-app uses) works only when a wallet sits behind the adapter to fulfil requests: actions emit `derived` requests with the issue/resolve args protocol (`mode`, `membershipProgram`, `membershipMapping: 'used_blinded_addresses'`, `targetAddress` on resolve) for the blinding slots, and `record` requests for records; the wallet fulfils from its private state and manages counters itself. (2) **Local signers — the SDK local account today, potentially a Leo-CLI-based local account client later:** no wallet exists to fulfil requests (local proving rejects `InputRequest` via `assertNoInputRequests`), so these ALWAYS pass **raw literal inputs** — a locally derived blinding factor/blinded address (Phase 2 lazy-SDK derivation for SDK accounts), scanner-selected record plaintext, and encoded values. Action params accept explicit literal overrides (`blindedIdentity?`, `tokenRecord?`) so any local signer can supply literals derived by its own means. Export `SHIELD_SWAP_ALGORITHM_GRANTS` (connect-time allowlist: swap_private pos 1,2; claim_swap_output_private pos 0,1) for wallet dapps.
- **Write method naming:** write methods/files/functions are the **camelCase of the transition name** — named after the transition, not re-aliased to a different concept: `swapPrivate`, `claimSwapOutputPrivate`, `createPool`, `mintPrivate`, `increaseLiquidityPrivate`. The **snake_case** form (`swap_private`, …) is only the string passed to the program (and ABI function-name assertions). Read/indexer methods keep descriptive `getX` names.
- **Green bar:** `pnpm vitest run` from repo root passes; if any `@veil/*` public API changes, update `examples/e2e-demo.ts` and `apps/loyalty-dapp/` and keep `pnpm --filter @veil/loyalty-dapp exec tsc --noEmit` clean (CLAUDE.md).
- **Reference revs:** contract `shield_swap_v0_0_2.aleo` @ Aleo testnet; Leo source `ProvableHQ/amm-v3`; derivation `ProvableHQ/amm-v3-tests@feat/q128` `src/client/amm-client.ts`; indexer `https://amm-api.dev.provable.com`.
- **Two test tiers.** (1) **Unit** — offline, mocked/crafted inputs, validate *our logic* (decoders, param math, blinding vs golden vectors); these are the default `pnpm vitest run` green bar. (2) **Integration** — hit the **REAL** API (live testnet node `api.provable.com/v2/testnet` + indexer `amm-api.dev.provable.com`), **never mocked/recorded**, and assert live responses decode into our generated/expected types (drift detection). Integration is **gated** behind `VEIL_INTEGRATION=1` so the offline default stays fast; CI runs it each push.
- **Run integration during development here:** for every read/action, write BOTH tiers and **run the gated integration test** (`VEIL_INTEGRATION=1 pnpm vitest run <path>`) against the real API before marking the task done — don't rely on the offline unit test alone. Discover live fixtures dynamically (`indexer.getPools()` → pick a pool → read from chain); assert **shape** for live reads, exact values only in the e2e that creates its own state.
- **Binding contributor constraints** (`.agents/contributors.md`, always-on via `AGENTS.md`):
  - **JSDoc on every public symbol** — verb-led one-line summary; document `@param`/`@returns`/`@throws` by consequence (never restate the name or type); state defaults, units (microcredits), numeric widths, and side effects (network/sign/prove/pure); `@property` tags for object fields; a compiling `@example`. No filler, no hype adjectives, no hedging. See `.agents/voice.md`.
  - **Interface/config shape** — options objects + `extend()`, configurable defaults, no hardcoded network/RPC/wallet. `IndexerClient` base URL is configurable.
  - **Sign-off rule (STOP):** do **not** modify `@veil/core` or `@veil/codegen` to make `@veil/shield-swap` work, and do **not** change any shared core interface/type, without stating the change + affected dependents and getting approval first. If Phase 0 reveals codegen can't handle the deployed ABI or `dynamic.record` types, **surface it — do not patch codegen silently.**

---

## File Structure

```
packages/shield-swap/
  package.json                      # @veil/shield-swap, deps: @veil/core, @provablehq/sdk
  tsup.config.ts                    # mirror packages/bridge
  tsconfig.json
  veil.config.json                  # codegen config: shield_swap abi → src/generated
  scripts/regen-abi.sh              # curl | jq | leo abi → pinned abi.json (Leo CLI, no custom parsing)
  abi/shield_swap_v0_0_2.json       # committed pinned ABI snapshot
  src/
    index.ts                        # public exports + shieldSwapActions
    constants.ts                    # program id, domains, FEE_TIERS, TICK_SPACINGS, tick sentinels
    generated/shield_swap.ts        # CODEGEN OUTPUT (committed): types + decoders
    types.ts                        # SwapHandle, intents, action param/return types
    encode.ts                       # to* primitive formatters + MintPositionRequest struct formatter
    blinded-identity.ts             # deriveBlindingFactor/deriveBlindedAddress + counter scan
    records.ts                      # record selection over requestRecords
    helpers/
      params.ts                     # slippage→sqrt_price_limit/amount_out_min, zero_for_one, getDeadline, nonce
      tick-hints.ts                 # pickInsertHint
      derivations.ts                # poolPrice, priceImpact, portfolioValue, feeAprEstimate
    actions/
      reads/                        # getPool, getSlot, getSwapOutput, isBlindedAddressUsed, validation reads
      swap/                         # swapPrivate, claimSwapOutputPrivate
      liquidity/                    # createPool, mintPrivate, increaseLiquidityPrivate
    indexer/
      client.ts                     # IndexerClient (base URL, auth/JWT)
      endpoints.ts                  # typed REST methods
    decorators/shieldSwapActions.ts        # client.extend() decorator
    agent/                          # agent tool schemas (one per action)
    mcp/                            # MCP tool registration
  test/                             # mirrors src/, plus test/integration/e2e.test.ts
```

---

## Phase 0 — Package scaffold + codegen build step

### Task 0.1: Scaffold the `@veil/shield-swap` package

**Files:**
- Create: `packages/shield-swap/package.json`, `packages/shield-swap/tsconfig.json`, `packages/shield-swap/tsup.config.ts`, `packages/shield-swap/src/index.ts`
- Reference: `packages/bridge/package.json`, `packages/bridge/tsup.config.ts` (copy structure)

**Interfaces:**
- Produces: the `@veil/shield-swap` workspace package with `build`/`test`/`typecheck` scripts.

- [ ] **Step 1: Copy bridge's package skeleton**, renaming to `@veil/shield-swap`, deps `{ "@veil/core": "workspace:*", "@provablehq/sdk": "<match core's version>" }`, and a `"generate": "tsx scripts/extract-abi.ts && veil-codegen --config veil.config.json"` script.
- [ ] **Step 2: Minimal `src/index.ts`**: `export const VERSION = '0.0.0'`.
- [ ] **Step 3: Verify it builds and is picked up by the workspace**

Run: `pnpm install && pnpm --filter @veil/shield-swap build`
Expected: build succeeds, emits `dist/`.

- [ ] **Step 4: Commit** (docs/scaffold — exempt from /code-review)

```bash
git add packages/dex
git commit -m "chore(dex): scaffold @veil/shield-swap package"
```

### Task 0.2: ABI extraction script (deployed `.aleo` → pinned `abi.json`)

> **REWORKED as implemented (supersedes the steps below):** per user direction we do **not**
> parse `.aleo` ourselves. `scripts/regen-abi.sh` runs `curl | jq -r . | leo abi` to produce the
> committed `abi/shield_swap_v0_0_2.json`. Since `leo abi` (4.2.0) emits a newer nested-mode
> variant format, core `parseAbi` was extended (backward-compatibly, signed off) to accept it —
> see `fix(core): parseAbi accepts leo 4.2.0 ABI format`. The `extract-abi.ts` steps below are
> retained only as historical record.

**Files:**
- Create: `packages/shield-swap/scripts/extract-abi.ts`, `packages/shield-swap/abi/shield_swap_v0_0_2.json` (generated artifact, committed)
- Uses: core `parseProgram` (`packages/core/src/contract/parseProgram.ts`) and `parseAbi` (`packages/core/src/utils/parseAbi.ts`) to validate shape.

**Interfaces:**
- Consumes: deployed program text from `https://api.provable.com/v2/testnet/program/shield_swap_v0_0_2.aleo` (JSON-encoded string; decode before parsing).
- Produces: `abi/shield_swap_v0_0_2.json` in the shape `parseAbi` accepts.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shield-swap/test/extract-abi.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseAbi } from '@veil/core'

describe('pinned shield_swap ABI', () => {
  it('parses and contains the V1 entrypoints', () => {
    const raw = JSON.parse(readFileSync('packages/shield-swap/abi/shield_swap_v0_0_2.json', 'utf-8'))
    const abi = parseAbi(raw)
    const fns = new Set(abi.functions.map((f) => f.name))
    for (const f of ['swap_private', 'claim_swap_output_private', 'create_pool', 'mint_private', 'increase_liquidity_private']) {
      expect(fns.has(f)).toBe(true)
    }
    const maps = new Set(abi.mappings.map((m) => m.name))
    for (const m of ['pools', 'slots', 'swap_outputs', 'used_blinded_addresses']) {
      expect(maps.has(m)).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run it — fails** (no `abi/shield_swap_v0_0_2.json` yet)

Run: `pnpm vitest run packages/shield-swap/test/extract-abi.test.ts`
Expected: FAIL (ENOENT).

- [ ] **Step 3: Write `scripts/extract-abi.ts`** — fetch the deployed program, `JSON.parse` (it's a JSON string), feed the `.aleo` source to `parseProgram`, map the resulting `Program` (`functions`/`mappings`/`closures`) into the `abi.json` shape `parseAbi` accepts (inspect `parseAbi.ts` for the exact shape), and write `abi/shield_swap_v0_0_2.json`. If the `Program`→ABI mapping proves lossy for any input/struct type, fall back to `leo build` of the fetched `amm-v3` source and copy its `build/abi.json`.

- [ ] **Step 4: Generate the pinned ABI**

Run: `pnpm --filter @veil/shield-swap exec tsx scripts/extract-abi.ts`
Expected: writes `abi/shield_swap_v0_0_2.json`.

- [ ] **Step 5: Run the test — passes**

Run: `pnpm vitest run packages/shield-swap/test/extract-abi.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shield-swap/scripts/extract-abi.ts packages/shield-swap/abi packages/shield-swap/test/extract-abi.test.ts
git commit -m "feat(dex): pin shield_swap ABI + extraction script"
```

### Task 0.3: Wire codegen → committed `src/generated/shield_swap.ts`

**Files:**
- Create: `packages/shield-swap/veil.config.json`, `packages/shield-swap/src/generated/shield_swap.ts` (codegen output, committed)
- Reference: `apps/loyalty-node/package.json` `generate` script + `apps/loyalty-node/src/generated/`

**Interfaces:**
- Produces: generated TS for the program — struct/record interfaces (`PoolState`, `Slot`, `Tick`, `Position`, `PositionNFT`, `MintPositionRequest`, `SwapOutput`, …) + `*FromRecord`/mapper decoders. These names are consumed by Phases 1–4.

- [ ] **Step 1: Write `veil.config.json`**: `{ "programs": [{ "abi": "./abi/shield_swap_v0_0_2.json", "out": "./src/generated/shield_swap.ts" }], "coreImport": "@veil/core" }`.
- [ ] **Step 2: Run codegen**

Run: `pnpm --filter @veil/shield-swap exec veil-codegen --config veil.config.json`
Expected: `Generated …/src/generated/shield_swap.ts`.

- [ ] **Step 3: Write a test asserting the generated decoders work** against a sample mapping value string (copy a real `slots`/`pools` value from `getMappingValue` output, or a crafted one matching the struct):

```ts
// packages/shield-swap/test/generated.test.ts — assert PoolState/Slot interfaces + a decoder round-trip on a sample value
```

- [ ] **Step 4: Run — passes**

Run: `pnpm vitest run packages/shield-swap/test/generated.test.ts`

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @veil/shield-swap exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shield-swap/veil.config.json packages/shield-swap/src/generated packages/shield-swap/test/generated.test.ts
git commit -m "feat(dex): generate typed bindings for shield_swap"
```

### Task 0.4: Constants

**Files:** Create `packages/shield-swap/src/constants.ts`

**Interfaces:**
- Produces: `PROGRAM_ID='shield_swap_v0_0_2.aleo'`, `BLINDING_FACTOR_DOMAIN`, `CLAIM_OR_SWAP_DOMAIN` (the exact field constants from the deployed program / reference client), `FEE_TIERS`, `TICK_SPACINGS`, `MIN_TICK_SENTINEL`, `MAX_TICK_SENTINEL`.

- [ ] **Step 1:** Copy the exact constant values from the reference client (`getAmmV3BlindingFactorDomain`, `getAmmV3ClaimOrSwapDomain`) and `constants` in the deployed `.aleo` (`CLAIM_OR_SWAP_DOMAIN = 11835072102227764468342786961086432175093421716844963782363567713633field`).
- [ ] **Step 2: Commit** `git add … && git commit -m "feat(dex): program constants"`.

---

## Phase 1 — Encode util + chain-direct reads

### Task 1.1: Primitive encode util

**Files:** Create `packages/shield-swap/src/encode.ts`, `packages/shield-swap/test/encode.test.ts`

**Interfaces:**
- Produces: `toField(s: string): string`, `toAddress(s): string`, `toU128(n: bigint): string`, `toU64/toU32/toU16/toU8(n: number): string`, `toI32(n: number): string`, `toBool(b: boolean): string`. Each appends the correct Aleo type suffix (`123u128`, `aleo1…` unchanged, `true`/`false`, `-5i32`). Port semantics from the reference's `formatting` utils.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest'
import { toU128, toI32, toBool, toField } from '../src/encode.js'
describe('encode', () => {
  it('suffixes types', () => {
    expect(toU128(100n)).toBe('100u128')
    expect(toI32(-5)).toBe('-5i32')
    expect(toBool(true)).toBe('true')
    expect(toField('123field')).toBe('123field')   // idempotent if already suffixed
    expect(toField('123')).toBe('123field')
  })
})
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
Run: `pnpm vitest run packages/shield-swap/test/encode.test.ts`
- [ ] **Step 5: Commit** `feat(dex): primitive encode util`.

### Task 1.2: `getPool` (static config read)

**Files:** Create `packages/shield-swap/src/actions/reads/getPool.ts`, `test/actions/reads/getPool.test.ts`

**Interfaces:**
- Consumes: core `getMappingValue(client, { program, mapping, key })`; the generated `PoolState` decoder.
- Produces: `getPool(client, { poolKey: string }): Promise<PoolState | null>` where `PoolState = { token0, token1, fee, enabled, scale0, scale1 }` (from generated types).

- [ ] **Step 1: Failing test** (mock `getMappingValue` to return a sample `pools` struct string; assert decoded fields).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — read `pools` mapping with `toField(poolKey)`, decode with the generated mapper, return `null` if absent.
- [ ] **Step 4:** Run → PASS. Run: `pnpm vitest run packages/shield-swap/test/actions/reads/getPool.test.ts`
- [ ] **Step 5: Commit** `feat(dex): getPool read`.

### Task 1.3: Sibling chain-direct reads (same pattern as 1.2)

Implement each as its own file + test, following Task 1.2 exactly (read mapping → decode → null-guard). One TDD cycle + commit per read:

| Action | Mapping | Key encode | Returns |
|---|---|---|---|
| `getSlot` | `slots` | `toField(poolKey)` | `Slot` (live: sqrt_price, tick, liquidity, fee growth, next_init_below/above) |
| `getSwapOutput` | `swap_outputs` | `toField(swapId)` | `SwapOutput` (amount_out, amount_remaining, token_in/out, + per-hop refund slots) — return `null` until finalized |
| `isBlindedAddressUsed` | `used_blinded_addresses` | `toAddress(addr)` | `boolean` (`result === 'true'`) |
| `isPoolInitialized` | `initialized_pools` | `toField(poolKey)` | `boolean` |
| `isFeeTierValid` | `fee_tiers` | `toU16(fee)` | `boolean` |
| `isTickSpacingValid` | `tick_spacings` | `toU32(spacing)` | `boolean` |
| `getFeeToTickSpacing` | `fee_to_tick_spacing` | `toU16(fee)` | `number \| null` (strip `u32`) |

- [ ] One task per row: failing test → run FAIL → implement → run PASS → commit `feat(dex): <action> read`.

---

## Phase 2 — BlindedIdentity (derivation + counter scan)

### Task 2.1: Port `deriveBlindingFactor` / `deriveBlindedAddress`

**Files:** Create `packages/shield-swap/src/blinded-identity.ts`, `test/blinded-identity.test.ts`

**Interfaces:**
- Consumes: `@provablehq/sdk` (`Field`, `Scalar`, `U32`, `Address`, `Poseidon8`); `constants.ts`.
- Produces: `deriveBlindingFactor(viewKeyScalar: string, counter: number): string` (field) and `deriveBlindedAddress(blindingFactor: string, signerAddress: string): string` (address). **Byte-for-byte ports** of the reference (`amm-v3-tests@feat/q128/src/client/amm-client.ts`), including the program-address x-coordinate, view-key scalar→field, and the load-bearing 252-bit `toBitsLe`/`fromBitsLe` repacking in `deriveBlindedAddress`.

- [ ] **Step 1: Write the failing test with KNOWN-GOOD VECTORS.** Before implementing, obtain vectors: run the reference client (or `loading-dex-context` to fetch it) for fixed `(viewKey, counter, signer)` triples and capture the expected `blindingFactor` + `blindedAddress`. Hardcode them:

```ts
import { describe, it, expect } from 'vitest'
import { deriveBlindingFactor, deriveBlindedAddress } from '../src/blinded-identity.js'
const V = [/* { viewKeyScalar, counter, signer, expectedBf, expectedAddr } captured from reference */]
describe('blinded identity (golden vectors)', () => {
  for (const v of V) it(`counter ${v.counter}`, () => {
    const bf = deriveBlindingFactor(v.viewKeyScalar, v.counter)
    expect(bf).toBe(v.expectedBf)
    expect(deriveBlindedAddress(bf, v.signer)).toBe(v.expectedAddr)
  })
})
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Port the two functions** verbatim from the reference (do not “improve” the bit-packing).
- [ ] **Step 4:** Run → PASS (vectors match exactly). Run: `pnpm vitest run packages/shield-swap/test/blinded-identity.test.ts`
- [ ] **Step 5: Commit** `feat(dex): blinded-factor/address derivation`.

### Task 2.2: Counter scan against `used_blinded_addresses`

**Files:** Modify `packages/shield-swap/src/blinded-identity.ts`; add `test/blinded-identity.scan.test.ts`

**Interfaces:**
- Consumes: `deriveBlindingFactor`, `deriveBlindedAddress`, `isBlindedAddressUsed` (Task 1.3).
- Produces: `nextBlindedIdentity(client, { viewKeyScalar, signer, startCounter? }): Promise<{ counter, blindingFactor, blindedAddress }>` — scans `counter = startCounter..`, returns the first whose `blindedAddress` is **not** in `used_blinded_addresses`. Throws a structured `BlindedAddressExhaustedError` after a sane cap.

- [ ] **Step 1: Failing test** — mock `isBlindedAddressUsed` to return `true` for counters 0–1 and `false` at 2; assert returned `counter === 2`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement scan loop. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(dex): blinded-address counter scan`.

---

## Phase 3 — Swap lifecycle

### Task 3.1: Param helpers (slippage, ordering, deadline, nonce)

**Files:** Create `packages/shield-swap/src/helpers/params.ts`, `test/helpers/params.test.ts`

**Interfaces:**
- Consumes: `getPool` (ordering), `getSlot` (`sqrt_price`); core block-height read for deadline.
- Produces:
  - `resolveSwapParams({ pool, slot, tokenIn, tokenOut, amountIn, slippageBps }): { zeroForOne, token0Id, token1Id, amountOutMin, sqrtPriceLimit }`
  - `getDeadline(client, offsetBlocks=100): Promise<number>` — current block height + offset (a u32 **block height**)
  - `generateSwapNonce(): bigint` (u64) and `generateFieldNonce(): string` (field)

- [ ] **Step 1: Failing test** for `resolveSwapParams` — given a pool with `token0 < token1` and a slot `sqrt_price`, assert `zeroForOne`, `amountOutMin = expected*(1-slippage)`, and `sqrtPriceLimit` direction. Use fixed numbers; assert the math.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (keep the price math un-fancy; document the fixed-point assumption matching `poolPrice`). **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(dex): swap param helpers`.

### Task 3.2: Record selection for token inputs

**Files:** Create `packages/shield-swap/src/records.ts`, `test/records.test.ts`

**Interfaces:**
- Consumes: core `requestRecords(client, { program, statusFilter: 'unspent' })` → `OwnedRecord[]` (each has `recordName`, `recordPlaintext`).
- Produces:
  - `selectTokenRecord(client, { tokenProgram, minAmount }): Promise<OwnedRecord>` — pick an unspent token record from `tokenProgram` whose plaintext `amount >= minAmount`; throw `InsufficientRecordsError` otherwise.
  - `selectPositionNFT(client, { poolKey }): Promise<OwnedRecord>` — pick the unspent `PositionNFT` record for `poolKey`.

- [ ] **Step 1: Failing test** — mock `requestRecords` to return sample plaintext records; assert selection by amount and by pool.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (parse amount/pool from `recordPlaintext`; reuse a small struct-field reader). **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(dex): record selection`.

### Task 3.2b: `getPrivateBalances` — tabulate balances from records

**Files:** Create `packages/shield-swap/src/actions/reads/getPrivateBalances.ts`, `test/actions/reads/getPrivateBalances.test.ts`. May add a shared `recordAmount(plaintext) → { tokenId, amount }` parser to `records.ts` (Task 3.2).

**Interfaces:**
- Consumes: core `requestRecords(client, { program, statusFilter: 'unspent' })`; the record-plaintext parser from `records.ts`.
- Produces: `getPrivateBalances(client, { tokenIds? }): Promise<Record<string, bigint>>` — requests the account's unspent token records, parses each plaintext for `{ tokenId, amount }`, and **sums per token id** (`bigint`, u128). Optionally filters to `tokenIds`. The caller's *private* record-derived balance — distinct from `indexer.getBalances` (public/authorized).
  - Read `amount`/token id from `recordPlaintext` (SDK path); fall back to `recordView.fields` when a privacy wallet withholds plaintext (total is bounded by what the grant exposes).
  - *Resolve at impl:* which program(s) hold token records (ARC-20 registry vs per-token) — see the spec's "Record-derived" note. Scan the registry if that's the model; otherwise accept a `programs[]`/`tokenIds[]` to scan.

- [ ] **Step 1: Failing test** — mock `requestRecords` to return several unspent token records across two token ids (incl. two records of the same token); assert the result sums per token id as `bigint`, and that `tokenIds` filtering works.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** — request unspent records, parse `{ tokenId, amount }`, reduce into a `Record<string, bigint>`.
- [ ] **Step 4:** Run → PASS. Run: `pnpm vitest run packages/shield-swap/test/actions/reads/getPrivateBalances.test.ts`
- [ ] **Step 5: Commit** `feat(dex): getPrivateBalances (record-derived)`.

### Task 3.3: `swapPrivate` → `SwapHandle`

**Files:** Create `packages/shield-swap/src/types.ts` (add `SwapHandle`), `packages/shield-swap/src/actions/swap/swapPrivate.ts`, `test/actions/swap/swapPrivate.test.ts`

**Interfaces:**
- Consumes: `resolveSwapParams`, `nextBlindedIdentity`, `selectTokenRecord`, `getDeadline`, `generateSwapNonce`, core wallet `executeContract`/`writeContract`, `encode.ts`.
- Produces:
  - `type SwapHandle = { swapId: string; blindingFactor: string; blindedAddress: string; tokenIn: string; tokenOut: string; poolKey: string; amountIn: bigint }`
  - `swapPrivate(client, params): Promise<SwapHandle>` — builds inputs for the `swap_private` transition (positional order: token_in record plaintext, blinding_factor, blinded_address, pool, zero_for_one, amount_in, amount_out_min, sqrt_price_limit, nonce, deadline, token0_id, token1_id), submits, computes/returns the `swapId` (BHP256 of `SwapKey` — match the contract; if SDK lacks BHP256 struct hashing, read it back from the tx outputs/`swap_outputs` instead) and the handle.

- [ ] **Step 1: Failing test** — mock the dependencies; assert the `inputs[]` array is built in exact positional order with correct encodings, and the returned `SwapHandle` carries the blinding identity + token ids.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
Run: `pnpm vitest run packages/shield-swap/test/actions/swap/swapPrivate.test.ts`
- [ ] **Step 5: Commit** `feat(dex): swapPrivate (swap_private transition)`.

### Task 3.4: `claimSwapOutputPrivate`

**Files:** Create `packages/shield-swap/src/actions/swap/claimSwapOutputPrivate.ts`, `test/actions/swap/claimSwapOutputPrivate.test.ts`

**Interfaces:**
- Consumes: `SwapHandle`, `getSwapOutput`, core `waitForTransaction`/block wait, `executeContract`, `encode.ts`.
- Produces: `claimSwapOutputPrivate(client, { handle: SwapHandle }): Promise<RawExecuteResult>` — waits for finalization, reads `getSwapOutput(handle.swapId)`; if absent, throw structured `SwapOutputNotFinalizedError` (retryable); builds `claim_swap_output_private` transition inputs (blinding_factor, blinded_address, swap_id, token_in, token_out, amount_out, amount_remaining) and submits.

- [ ] **Step 1: Failing test** — mock `getSwapOutput` to return amounts; assert input order/encoding. Add a second test: `getSwapOutput` returns null → throws `SwapOutputNotFinalizedError`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(dex): claimSwapOutputPrivate (claim_swap_output_private transition)`.

---

## Phase 4 — Liquidity lifecycle

### Task 4.1: Tick hints

**Files:** Create `packages/shield-swap/src/helpers/tick-hints.ts`, `test/helpers/tick-hints.test.ts`

**Interfaces:**
- Consumes: `getSlot`.
- Produces: `pickInsertHint(client, { poolKey, targetTick }): Promise<number>` — port the reference's logic from `slot.next_init_below`/`next_init_above`; throw `TickHintUnavailableError` for the unsupported multi-intervening-tick case (documented limitation).

- [ ] **Step 1: Failing test** — craft slots with given `tick`/`next_init_below`/`next_init_above`; assert the chosen hint for targetTick above and below `slot.tick`, and the throw for the unsupported case.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(dex): tick insert-hint helper`.

### Task 4.2: `MintPositionRequest` struct formatter

**Files:** Modify `packages/shield-swap/src/encode.ts`; add `test/encode.mint-request.test.ts`

**Interfaces:**
- Consumes: generated `MintPositionRequest` type, `encode.ts` primitives.
- Produces: `formatMintPositionRequest(req: MintPositionRequest): string` — a Leo struct string with fields in **exact contract order**: `pool, tick_lower, tick_upper, amount0_desired, amount1_desired, amount0_min, amount1_min, tick_lower_hint, tick_upper_hint`, each suffixed.

- [ ] **Step 1: Failing test** asserting exact struct string. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Commit** `feat(dex): MintPositionRequest formatter`.

### Task 4.3: `createPool`

**Files:** Create `packages/shield-swap/src/actions/liquidity/createPool.ts`, test

**Interfaces:**
- Consumes: `isFeeTierValid`, `getFeeToTickSpacing`, `executeContract`, `encode.ts`.
- Produces: `createPool(client, { token0ProgramId, token1ProgramId, fee, initialSqrtPrice, tickSpacing, initialTick }): Promise<RawExecuteResult>` — pre-flight validate fee/tick-spacing; build `create_pool` transition inputs (all public, positional order from ABI); submit.

- [ ] **Step 1–4: TDD** (test asserts pre-flight calls + input order). **Step 5: Commit** `feat(dex): createPool`.

### Task 4.4: `mintPrivate`

**Files:** Create `packages/shield-swap/src/actions/liquidity/mintPrivate.ts`, test

**Interfaces:**
- Consumes: `selectTokenRecord` (×2), `pickInsertHint`, `formatMintPositionRequest`, `generateFieldNonce`, `executeContract`.
- Produces: `mintPrivate(client, params): Promise<{ result: RawExecuteResult; positionTokenId: string }>` — selects token0/token1 records, computes tick hints, builds `mint_private` transition inputs (nonce, token0 record, token1 record, recipient, MintPositionRequest, token0_id, token1_id), submits, returns the position token id (from outputs).

- [ ] **Step 1–4: TDD.** **Step 5: Commit** `feat(dex): mintPrivate`.

### Task 4.5: `increaseLiquidityPrivate`

**Files:** Create `packages/shield-swap/src/actions/liquidity/increaseLiquidityPrivate.ts`, test

**Interfaces:**
- Consumes: `selectPositionNFT`, `selectTokenRecord` (×2), `pickInsertHint`, `executeContract`.
- Produces: `increaseLiquidityPrivate(client, params): Promise<RawExecuteResult>` — selects the PositionNFT + token records, builds `increase_liquidity_private` transition inputs (PositionNFT record, token0 record, token1 record, amount0_desired, amount1_desired, amount0_min, amount1_min, token0_id, token1_id, tick_lower_hint, tick_upper_hint), submits.

- [ ] **Step 1–4: TDD.** **Step 5: Commit** `feat(dex): increaseLiquidityPrivate`.

---

## Phase 5 — IndexerClient (off-chain REST)

### Task 5.1: `IndexerClient` core (base URL + auth/JWT)

**Files:** Create `packages/shield-swap/src/indexer/client.ts`, `test/indexer/client.test.ts`

**Interfaces:**
- Produces: `class IndexerClient { constructor(opts?: { baseUrl?: string }) ; auth: { challenge(address): Promise<...>; verify(address, signature): Promise<...> }; private get<T>(path, query?); private post<T>(path, body, { auth? }) }`. Stores the JWT from `verify` and attaches `Authorization: Bearer` to auth-gated calls. Default `baseUrl = 'https://amm-api.dev.provable.com'`.

- [ ] **Step 1: Failing test** with a mocked `fetch` — assert `get` builds the URL+query, `verify` stores the token, and a `post({ auth:true })` attaches the bearer header.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Commit** `feat(dex): IndexerClient core + auth`.

### Task 5.2: Indexer endpoint methods

**Files:** Create `packages/shield-swap/src/indexer/endpoints.ts`, `test/indexer/endpoints.test.ts`

**Interfaces:** Produces typed methods over `IndexerClient` (response types from `/openapi.json`). Each is a 1–3 line wrapper; implement all, one test file asserting URL/params for each (mock `fetch`). Group:

| Method | HTTP | Path | Auth |
|---|---|---|---|
| `getPools/getPool` | GET | `/pools`, `/pools/{key}` | — |
| `getPoolStats` | GET | `/pools/{key}/stats` | — |
| `getPoolTrades` | GET | `/pools/{key}/trades` | — |
| `getPoolOhlcv` | GET | `/pools/{key}/ohlcv` | — |
| `getSwaps/getSwap` | GET | `/swaps`, `/swaps/{id}` | — |
| `getRoute` | GET | `/route` | — |
| `getPositions/getPosition` | GET | `/positions`, `/positions/{id}` | — |
| `getTokens/getToken` | GET | `/tokens`, `/tokens/{addr}` | — |
| `registerToken` | POST | `/tokens` | ✅ |
| `getBalances` | GET | `/balances` | — |
| `getFeeTiers/getTickSpacings` | GET | `/fee-tiers`, `/tick-spacings` | — |
| `getTradingSchema` | GET | `/schema/trading[/{id}]` | — |
| `airdrop` | POST | `/airdrop` | — |
| `getAirdropStatus` | GET | `/airdrop/{job_id}` | — |
| `debugPool` | GET | `/debug/pool` | — |

- [ ] **Step 1: Failing test** covering each method's URL/verb (mock `fetch`). **Step 2:** FAIL. **Step 3:** Implement all. **Step 4:** PASS. **Step 5: Commit** `feat(dex): indexer endpoint methods`.

---

## Phase 6 — Derivation/strategy helpers

### Task 6.1: `poolPrice` (golden-vector tested)

**Files:** Create `packages/shield-swap/src/helpers/derivations.ts`, `test/helpers/derivations.test.ts`

**Interfaces:**
- Produces: `poolPrice({ sqrtPrice, scale0, scale1, decimals0, decimals1 }): { price0Per1: number; price1Per0: number }` — convert the fixed-point `sqrt_price` (Q64 now; Q128 in flight) to a human price using `scale0`/`scale1` + decimals. Match the contract's fixed-point format exactly.

- [ ] **Step 1: Failing test with vectors** captured from the reference/contract for known `sqrt_price`. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. **Step 5: Commit** `feat(dex): poolPrice helper`.

### Task 6.2: `priceImpact`, `portfolioValue`, `feeAprEstimate`

Each its own pure function + test (one TDD cycle + commit each), per the spec's Derivation helpers table:
- `priceImpact({ liquidity, ticks, amountIn, zeroForOne })` → `{ expectedOut, effectivePrice, impactBps }` (read-only approximation of the contract swap-step math; documented).
- `portfolioValue(balances, prices, decimals)` → total in a chosen quote token.
- `feeAprEstimate({ volume, feeTier, liquidityShare })` → rough APR.

- [ ] One task per helper: failing test → FAIL → implement → PASS → commit.

---

## Phase 7 — Decorator wiring

### Task 7.1: `shieldSwapActions` decorator + `extend()` integration

**Files:** Create `packages/shield-swap/src/decorators/shieldSwapActions.ts`; update `src/index.ts`; `test/decorators/shieldSwapActions.test.ts`

**Interfaces:**
- Consumes: every action from Phases 1–6, the `IndexerClient`.
- Produces: `shieldSwapActions(client) => { getPool, getSlot, getSwapOutput, getPrivateBalances, …, swapPrivate, claimSwapOutputPrivate, createPool, mintPrivate, increaseLiquidityPrivate, indexer, poolPrice, … }`, attachable via `client.extend(shieldSwapActions)`. Mirror `packages/core/src/clients/decorators/*` (each entry `name: (params) => action(client, params)`).

- [ ] **Step 1: Failing test** — `createWalletClient(...).extend(shieldSwapActions)` exposes the actions and a call routes to the underlying function (mock one).
- [ ] **Step 2:** FAIL. **Step 3:** Implement + export from `index.ts`. **Step 4:** PASS. **Step 5: Commit** `feat(dex): shieldSwapActions decorator`.

---

## Phase 9 — Agent + MCP surfaces (runs AFTER the e2e — reordered per user)

### Task 8.1: Agent tool schemas

**Files:** Create `packages/shield-swap/src/agent/*.ts`, `test/agent/schemas.test.ts`
**Interfaces:** one agent tool schema per action (name, description, JSON-schema params, structured JSON result), generated from the action param types. Mirror `packages/core/src/agent/`.

- [ ] **TDD:** test asserts each schema validates a sample params object and lists all V1 actions → implement → commit `feat(dex): agent tool schemas`.

### Task 8.2: MCP tools

**Files:** Create `packages/shield-swap/src/mcp/*.ts`, `test/mcp/server.test.ts`
**Interfaces:** register one MCP tool per action wrapping the same function, returning structured JSON + actionable errors (`BlindedAddressExhaustedError`, `SwapOutputNotFinalizedError`, `InsufficientRecordsError`, `TickHintUnavailableError`). Mirror `packages/core/src/mcp/`.

- [ ] **TDD:** test registers the server and asserts a tool call routes through → implement → commit `feat(dex): MCP tools`.

---

## Phase 8 — End-to-end integration test (the headline goal; reordered BEFORE agent/MCP per user)

### Task 9.1: Full lifecycle e2e against testnet

**Files:** Create `packages/shield-swap/test/integration/e2e.test.ts` (gated behind the integration env flag)

**Interfaces:** Consumes the full client via `extend(shieldSwapActions)`.

- [ ] **Step 1: Write the gated e2e** — `indexer.airdrop(addr)` → `createPool` → `mintPrivate` → `increaseLiquidityPrivate` → `swapPrivate` → wait → `getSwapOutput` → `claimSwapOutputPrivate`, asserting end-state balances/records and that `getSwapOutput` matched the claim.
- [ ] **Step 2: Run gated**

Run: `VEIL_INTEGRATION=1 pnpm vitest run packages/shield-swap/test/integration/e2e.test.ts`
Expected: PASS against testnet.

- [ ] **Step 3: Confirm default run stays offline**

Run: `pnpm vitest run`
Expected: PASS, e2e skipped without the flag.

- [ ] **Step 4: Update `examples/e2e-demo.ts`** to include a DEX swap snippet (per CLAUDE.md sync rule); keep `pnpm --filter @veil/loyalty-dapp exec tsc --noEmit` clean if any shared API changed.
- [ ] **Step 5: Commit** `test(dex): e2e swap + liquidity lifecycle`.

---

## Self-Review

- **Spec coverage:** writes (3.3, 3.4, 4.3–4.5), layered reads (Phase 1 chain-direct + Phase 5 indexer), blinding lifecycle (Phase 2), two-phase SwapHandle + finalize-wait (3.3, 3.4), param + derivation helpers (3.1, 6.x), tick hints (4.1), records via core scanner (3.2), codegen build step (Phase 0), agent/MCP (Phase 8), e2e (Phase 9). `decrease_liquidity_private`, multi-hop, convenience `swap()` are spec non-goals — intentionally absent.
- **Open risk flagged in-task:** `swapId` BHP256 parity (3.3) and `poolPrice` fixed-point format (6.1) both depend on SDK hashing/Q-format details — each task says to fall back to read-back / golden vectors rather than guess.
