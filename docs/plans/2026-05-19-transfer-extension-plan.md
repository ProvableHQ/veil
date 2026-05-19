# transfer action + swap routing extension Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `@veil/core`'s `transfer` action to support `token_registry.aleo`, `usdcx_stablecoin.aleo`, and `usad_stablecoin.aleo` alongside `credits.aleo`; update `@veil/bridge`'s `swap` to route the unshield deposit through the extended `transfer` based on the source asset.

**Architecture:** Single entry point pattern — callers always call `transfer({ asset, to, amount, visibility, ... })`, the action picks the right inputs/widths/function for each token-program family. Bridge's `swap` consults a small asset → program map and delegates to `transfer`.

**Tech Stack:** TypeScript ESM, vitest, pnpm. No new dependencies.

**Context:**
- Branch `feat/bridge-client` (already pushed as PR #61). New commits land on the same branch.
- Tests run via `pnpm vitest run packages/<pkg>/test/` from the repo root.
- Three program signatures the extension covers (from `api.provable.com/v2/mainnet/programs/`):
  - `credits.aleo / transfer_private_to_public` — wallet auto-resolves record; explicit inputs `[to, amount{u64}]`
  - `token_registry.aleo / transfer_private_to_public` — wallet auto-resolves record; explicit inputs `[to, amount{u128}]` (the token_id is embedded in the record itself)
  - `usdcx_stablecoin.aleo` / `usad_stablecoin.aleo` `/ transfer_private_to_public` — wallet auto-resolves record; explicit inputs `[to, amount{u128}, merkleProof]`

---

## Task 1: Extend `TransferParameters` and `transfer` implementation

**Files:**
- Modify: `packages/core/src/actions/wallet/transfer.ts`

- [ ] **Step 1: Replace `TransferParameters` + `transfer()` with the extended shape**

```typescript
import type { Client } from '../../clients/createClient.js'
import { writeContract } from './writeContract.js'

export type TransferVisibility = 'public' | 'private' | 'shield' | 'unshield'

export type TransferParameters = {
  /** Aleo program id. Defaults to 'credits.aleo'. */
  asset?: string
  /** Visibility mode. Defaults to 'public'. */
  visibility?: TransferVisibility
  to: string
  amount: bigint
  /**
   * Merkle proof input for compliance-bearing programs (usdcx_stablecoin.aleo,
   * usad_stablecoin.aleo) on private/unshield transfers. Provided as a single
   * pre-formatted Aleo input string matching the program's `[MerkleProof; 2u32].private`
   * shape.
   */
  merkleProof?: string
  /**
   * Override the inferred amount width. Defaults: 'u64' for credits.aleo;
   * 'u128' for token_registry/usdcx/usad. Caller can override for custom programs.
   */
  amountWidth?: 'u64' | 'u128'
  /**
   * Override the inferred function name (e.g. 'transfer_public_as_signer').
   * When omitted, derived from `visibility`.
   */
  function?: string
  /**
   * Override the full inputs array. When set, all other input-derivation params
   * are ignored. Escape hatch for programs whose signatures don't match a known shape.
   */
  inputs?: string[]
  /** Override the inferred privateFee. */
  privateFee?: boolean
}

export type TransferReturnType = string

const KNOWN_U128_PROGRAMS: ReadonlySet<string> = new Set([
  'token_registry.aleo',
  'usdcx_stablecoin.aleo',
  'usad_stablecoin.aleo',
])

const KNOWN_MERKLE_PROOF_PROGRAMS: ReadonlySet<string> = new Set([
  'usdcx_stablecoin.aleo',
  'usad_stablecoin.aleo',
])

function getFunctionName(visibility: TransferVisibility): string {
  switch (visibility) {
    case 'public': return 'transfer_public'
    case 'private': return 'transfer_private'
    case 'shield': return 'transfer_public_to_private'
    case 'unshield': return 'transfer_private_to_public'
  }
}

function inferAmountWidth(asset: string, override?: 'u64' | 'u128'): 'u64' | 'u128' {
  if (override) return override
  return KNOWN_U128_PROGRAMS.has(asset) ? 'u128' : 'u64'
}

function buildInputs(
  asset: string,
  visibility: TransferVisibility,
  to: string,
  amount: bigint,
  width: 'u64' | 'u128',
  merkleProof?: string,
): string[] {
  const encodedAmount = `${amount}${width}`
  const base = [to, encodedAmount]

  // Compliance programs need a merkle-proof input on private/unshield modes.
  if (
    (visibility === 'private' || visibility === 'unshield') &&
    KNOWN_MERKLE_PROOF_PROGRAMS.has(asset)
  ) {
    if (!merkleProof) {
      throw new Error(
        `transfer: ${asset} requires merkleProof for visibility=${visibility}`,
      )
    }
    return [...base, merkleProof]
  }

  return base
}

export async function transfer(
  client: Client,
  params: TransferParameters,
): Promise<TransferReturnType> {
  const asset = params.asset ?? 'credits.aleo'
  const visibility = params.visibility ?? 'public'
  const functionName = params.function ?? getFunctionName(visibility)
  const width = inferAmountWidth(asset, params.amountWidth)
  const inputs =
    params.inputs ?? buildInputs(asset, visibility, params.to, params.amount, width, params.merkleProof)
  const privateFee =
    params.privateFee ?? (visibility === 'private' || visibility === 'unshield')

  return writeContract(client, {
    program: asset,
    function: functionName,
    inputs,
    privateFee,
  })
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `pnpm vitest run packages/core/test/actions/wallet/transfer.test.ts` from repo root.

Expected: 7/7 PASS (existing behavior unchanged for `credits.aleo`).

If a test fails because input encoding changed, investigate before continuing — the existing semantics must be preserved.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/actions/wallet/transfer.ts
git commit -m "extend transfer to support token_registry, usdcx, usad shapes"
```
NO `Co-Authored-By` line.

---

## Task 2: Add tests for the new transfer behaviors

**Files:**
- Modify: `packages/core/test/actions/wallet/transfer.test.ts` (append new `describe` blocks; preserve existing tests)

- [ ] **Step 1: Append new test blocks**

Add these after the existing `describe('transfer', () => { ... })` block (do NOT modify existing tests):

```typescript
describe('transfer — token_registry.aleo', () => {
  it('emits u128 amount and uses token_registry.aleo program', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 1000n,
      asset: 'token_registry.aleo',
      visibility: 'unshield',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'token_registry.aleo',
        functionName: 'transfer_private_to_public',
        inputs: ['aleo1dest', '1000u128'],
        privateFee: true,
      }),
    })
  })

  it('shield path emits u128 and uses transfer_public_to_private', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 500n,
      asset: 'token_registry.aleo',
      visibility: 'shield',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'token_registry.aleo',
        functionName: 'transfer_public_to_private',
        inputs: ['aleo1dest', '500u128'],
        privateFee: false,
      }),
    })
  })
})

describe('transfer — usdcx_stablecoin.aleo', () => {
  it('private mode appends merkleProof input', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 250n,
      asset: 'usdcx_stablecoin.aleo',
      visibility: 'private',
      merkleProof: '[ {} , {} ]',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'usdcx_stablecoin.aleo',
        functionName: 'transfer_private',
        inputs: ['aleo1dest', '250u128', '[ {} , {} ]'],
        privateFee: true,
      }),
    })
  })

  it('unshield mode appends merkleProof input', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 1n,
      asset: 'usdcx_stablecoin.aleo',
      visibility: 'unshield',
      merkleProof: 'mp-input',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'usdcx_stablecoin.aleo',
        functionName: 'transfer_private_to_public',
        inputs: ['aleo1dest', '1u128', 'mp-input'],
        privateFee: true,
      }),
    })
  })

  it('public mode does NOT append merkleProof', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 1n,
      asset: 'usdcx_stablecoin.aleo',
      visibility: 'public',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'usdcx_stablecoin.aleo',
        functionName: 'transfer_public',
        inputs: ['aleo1dest', '1u128'],
        privateFee: false,
      }),
    })
  })

  it('throws when merkleProof is missing for unshield', async () => {
    const { client } = mockClient()
    await expect(
      transfer(client, {
        to: 'aleo1dest',
        amount: 1n,
        asset: 'usdcx_stablecoin.aleo',
        visibility: 'unshield',
      }),
    ).rejects.toThrow(/merkleProof/)
  })
})

describe('transfer — usad_stablecoin.aleo', () => {
  it('private mode appends merkleProof and uses u128 width', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 42n,
      asset: 'usad_stablecoin.aleo',
      visibility: 'private',
      merkleProof: 'mp',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'usad_stablecoin.aleo',
        functionName: 'transfer_private',
        inputs: ['aleo1dest', '42u128', 'mp'],
        privateFee: true,
      }),
    })
  })
})

describe('transfer — escape hatches', () => {
  it('inputs override is passed verbatim and bypasses asset-derived inputs', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 1n,
      asset: 'custom.aleo',
      visibility: 'private',
      inputs: ['arg0', 'arg1', 'arg2'],
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        programName: 'custom.aleo',
        functionName: 'transfer_private',
        inputs: ['arg0', 'arg1', 'arg2'],
      }),
    })
  })

  it('function override is passed verbatim', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 100n,
      function: 'transfer_public_as_signer',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        functionName: 'transfer_public_as_signer',
      }),
    })
  })

  it('amountWidth override forces u128 on credits.aleo', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 1n,
      amountWidth: 'u128',
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        inputs: ['aleo1dest', '1u128'],
      }),
    })
  })

  it('privateFee override forces true on public transfer', async () => {
    const { client, request } = mockClient()
    await transfer(client, {
      to: 'aleo1dest',
      amount: 1n,
      privateFee: true,
    })
    expect(request).toHaveBeenCalledWith({
      method: 'executeTransaction',
      params: expect.objectContaining({
        functionName: 'transfer_public',
        privateFee: true,
      }),
    })
  })
})
```

- [ ] **Step 2: Run tests**

Run: `pnpm vitest run packages/core/test/actions/wallet/transfer.test.ts`
Expected: existing 7 tests PASS + 11 new tests PASS (18 total).

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/actions/wallet/transfer.test.ts
git commit -m "test transfer extension across token_registry, usdcx, usad and escape hatches"
```

---

## Task 3: Add asset → Aleo program map in `@veil/bridge`

**Files:**
- Create: `packages/bridge/src/lib/aleo-asset.ts`
- Create: `packages/bridge/test/lib/aleo-asset.test.ts`

The bridge package keeps a map from source-asset symbol (as the bridge API uses it) to the Aleo program that holds that asset on the Aleo side. The map is exposed so consumers can extend it.

- [ ] **Step 1: Write failing test**

Create `packages/bridge/test/lib/aleo-asset.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { aleoAssetProgram, DEFAULT_ALEO_ASSET_MAP } from '../../src/lib/aleo-asset.js'

describe('aleoAssetProgram', () => {
  it('maps ALEO to credits.aleo', () => {
    expect(aleoAssetProgram('ALEO')).toEqual({ program: 'credits.aleo' })
  })

  it('maps WBTC/WETH/WUSDC/WSOL to token_registry.aleo', () => {
    expect(aleoAssetProgram('WBTC')).toEqual({ program: 'token_registry.aleo' })
    expect(aleoAssetProgram('WETH')).toEqual({ program: 'token_registry.aleo' })
    expect(aleoAssetProgram('WUSDC')).toEqual({ program: 'token_registry.aleo' })
    expect(aleoAssetProgram('WSOL')).toEqual({ program: 'token_registry.aleo' })
  })

  it('maps USDCX to usdcx_stablecoin.aleo with requiresMerkleProof', () => {
    expect(aleoAssetProgram('USDCX')).toEqual({
      program: 'usdcx_stablecoin.aleo',
      requiresMerkleProof: true,
    })
  })

  it('maps USAD to usad_stablecoin.aleo with requiresMerkleProof', () => {
    expect(aleoAssetProgram('USAD')).toEqual({
      program: 'usad_stablecoin.aleo',
      requiresMerkleProof: true,
    })
  })

  it('accepts case-insensitive symbol lookup', () => {
    expect(aleoAssetProgram('aleo')).toEqual({ program: 'credits.aleo' })
    expect(aleoAssetProgram('usdcx')).toEqual({
      program: 'usdcx_stablecoin.aleo',
      requiresMerkleProof: true,
    })
  })

  it('exposes DEFAULT_ALEO_ASSET_MAP for external extension', () => {
    expect(DEFAULT_ALEO_ASSET_MAP.ALEO).toBeDefined()
    expect(DEFAULT_ALEO_ASSET_MAP.USDCX).toBeDefined()
  })

  it('throws for an unknown asset', () => {
    expect(() => aleoAssetProgram('NOT_AN_ASSET')).toThrow(/unknown.*aleo asset/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/bridge/test/lib/aleo-asset.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `packages/bridge/src/lib/aleo-asset.ts`:

```typescript
import { BridgeError } from '../errors/bridgeErrors.js'

/**
 * Configuration for how a source-asset symbol maps to its Aleo program for the
 * unshield deposit step. Consumers can extend the map at call time by passing
 * an override (see swap action's optional aleoAssetMap param).
 */
export type AleoAssetConfig = {
  program: string
  /** Set when the underlying program requires a merkle-proof input on
   *  private/unshield transitions (usdcx_stablecoin, usad_stablecoin, etc). */
  requiresMerkleProof?: boolean
}

export const DEFAULT_ALEO_ASSET_MAP: Readonly<Record<string, AleoAssetConfig>> = Object.freeze({
  ALEO: { program: 'credits.aleo' },
  WBTC: { program: 'token_registry.aleo' },
  WETH: { program: 'token_registry.aleo' },
  WUSDC: { program: 'token_registry.aleo' },
  WSOL: { program: 'token_registry.aleo' },
  USDCX: { program: 'usdcx_stablecoin.aleo', requiresMerkleProof: true },
  USAD: { program: 'usad_stablecoin.aleo', requiresMerkleProof: true },
})

export function aleoAssetProgram(
  symbol: string,
  map: Readonly<Record<string, AleoAssetConfig>> = DEFAULT_ALEO_ASSET_MAP,
): AleoAssetConfig {
  const config = map[symbol.toUpperCase()]
  if (!config) {
    throw new BridgeError(
      `Unknown Aleo asset "${symbol}". Extend DEFAULT_ALEO_ASSET_MAP or pass a custom aleoAssetMap.`,
    )
  }
  return config
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/bridge/test/lib/aleo-asset.test.ts`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/lib/aleo-asset.ts packages/bridge/test/lib/aleo-asset.test.ts
git commit -m "add asset → Aleo program mapping helper"
```

---

## Task 4: Update `bridge.swap` to use `transfer` action with asset routing

**Files:**
- Modify: `packages/bridge/src/actions/swap.ts`
- Modify: `packages/bridge/test/actions/swap.test.ts`

- [ ] **Step 1: Update `SwapParameters` and the implementation**

In `packages/bridge/src/actions/swap.ts`:

- Add `merkleProof?: string` to `SwapParameters` (used only when the source asset is compliance-bearing).
- Add `aleoAssetMap?: Readonly<Record<string, AleoAssetConfig>>` to allow consumer overrides.
- Replace the existing `params.wallet.executeContract(...)` block with a call to `transfer` from `@veil/core`.
- Read the source asset from `params.from.asset` and look up the program via `aleoAssetProgram`.
- The `record` parameter on `SwapParameters` becomes unused for the new transfer path (wallet auto-resolves records) — remove it from `SwapParameters` and update tests.

Replace the section starting at "if (!params.wallet.account)" through the deposit call with:

```typescript
import { transfer } from '@veil/core'
// ...add this import at top of file...
import { aleoAssetProgram, type AleoAssetConfig } from '../lib/aleo-asset.js'

// ... existing imports ...

export type SwapParameters = {
  wallet: WalletClient
  from: { asset: string; amount: string }
  to: { chain: string; asset: string; address: string }
  selectQuote?:
    | 'best'
    | 'fastest'
    | ((quotes: BridgeQuote[]) => BridgeQuote | Promise<BridgeQuote>)
    | undefined
  /** Required only when the source asset's Aleo program requires a merkle proof
   *  (e.g. USDCX, USAD). Pre-formatted as a single Aleo input string. */
  merkleProof?: string | undefined
  /** Override the default asset → program map. */
  aleoAssetMap?: Readonly<Record<string, AleoAssetConfig>> | undefined
  poll?: boolean | BridgeOrderStage | undefined
  timezone?: string | undefined
  onStage?: ((status: BridgeOrderStatusDto) => void) | undefined
}

// ... in swap() body, after createOrder returns instructions, replace the
// wallet.executeContract block with: ...

  const assetConfig = aleoAssetProgram(params.from.asset, params.aleoAssetMap)

  if (assetConfig.requiresMerkleProof && !params.merkleProof) {
    throw new BridgeError(
      `swap source asset ${params.from.asset} requires merkleProof; pass via SwapParameters.merkleProof`,
    )
  }

  const depositTxId = await transfer(params.wallet, {
    asset: assetConfig.program,
    to: instructions.depositAddress,
    amount: BigInt(instructions.depositAmount),
    visibility: 'unshield',
    merkleProof: params.merkleProof,
  })
```

Remove the existing `record: string` field from `SwapParameters` and the `inputs: [params.record, ...]` block.

- [ ] **Step 2: Update swap tests**

In `packages/bridge/test/actions/swap.test.ts`:

- Remove `record` from `baseParams` and from the `executeContract` assertion (no longer relevant).
- The `makeWallet()` helper now needs to mock `wallet.transfer` (or, since `transfer` is a module-level import, mock `client.request` on the wallet client itself — `transfer` ultimately calls `writeContract` → `client.request({ method: 'executeTransaction', ... })`).

The simplest mock is to extend `makeWallet` to provide `request` (used by `writeContract` for RPC accounts), making `transfer` resolve to a tx id:

```typescript
function makeWallet(over: Partial<{ address: string; transactionId: string }> = {}): WalletClient {
  const txId = over.transactionId ?? 'at1deadbeef'
  return {
    account: { type: 'rpc', address: over.address ?? 'aleo1sender', sign: vi.fn() },
    request: vi.fn().mockResolvedValue(txId),
  } as unknown as WalletClient
}
```

Update the deposit assertion to check that `wallet.request` was called with `executeTransaction` for the unshield transition. For an ALEO-source swap:

```typescript
const requestMock = (wallet as any).request as ReturnType<typeof vi.fn>
expect(requestMock).toHaveBeenCalledWith({
  method: 'executeTransaction',
  params: expect.objectContaining({
    programName: 'credits.aleo',
    functionName: 'transfer_private_to_public',
    inputs: ['aleo1deposit', '1500000u64'],
    privateFee: true,
  }),
})
```

Then add new tests for:

- A `USDCX` source asset with `merkleProof` — assert `programName: 'usdcx_stablecoin.aleo'`, `inputs: ['aleo1deposit', '1500000u128', merkleProofValue]`, `privateFee: true`.
- A `WBTC` source asset — assert `programName: 'token_registry.aleo'`, `inputs: ['aleo1deposit', '1500000u128']`, `privateFee: true`.
- A `USDCX` swap WITHOUT `merkleProof` — expect `BridgeError` mentioning merkle proof.

Remove the existing "no wallet account" test and the use of `record` field. Keep tests for selectQuote variants and poll=false.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run packages/bridge/test/`
Expected: All bridge tests pass — getQuotes / createOrder / getOrder / getOrderAudit / waitForOrder / swap / unwrap envelope / httpBridge / createBridgeClient / mcp tools / aleo-asset. Total around 55 tests (48 prior - the changed swap tests + the new ones).

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @veil/bridge typecheck && pnpm --filter @veil/core typecheck`
Expected: PASS.

Run: `pnpm --filter @veil/bridge build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/actions/swap.ts packages/bridge/test/actions/swap.test.ts
git commit -m "route swap deposit through transfer action with asset-specific program"
```

---

## Task 5: Export the new types and helper from `@veil/bridge`'s public surface

**Files:**
- Modify: `packages/bridge/src/index.ts`

- [ ] **Step 1: Add exports**

Append after the existing `// Utilities` section:

```typescript
// Asset routing
export {
  aleoAssetProgram,
  DEFAULT_ALEO_ASSET_MAP,
  type AleoAssetConfig,
} from './lib/aleo-asset.js'
```

- [ ] **Step 2: Build + typecheck**

Run: `pnpm --filter @veil/bridge build && pnpm --filter @veil/bridge typecheck`
Expected: PASS, `dist/index.js` and `dist/index.d.ts` contain the new exports.

- [ ] **Step 3: Commit**

```bash
git add packages/bridge/src/index.ts
git commit -m "export aleo asset map from bridge index"
```

---

## Task 6: MCP tool schema update for swap

**Files:**
- Modify: `packages/bridge/src/mcp/tools.ts`
- Modify: `packages/bridge/test/mcp/tools.test.ts`

The swap MCP tool's input schema currently has `required: ['from', 'to', 'record']`. Remove `record`; add `merkleProof` as optional.

- [ ] **Step 1: Update the schema for `bridge_swap`**

In `packages/bridge/src/mcp/tools.ts`, in the `bridge_swap` entry:

- Remove the `record` property and remove `record` from `required`.
- Add a `merkleProof: { type: 'string', description: 'Pre-formatted [MerkleProof; 2u32] input string. Required only for compliance-bearing source assets (USDCX, USAD).' }` to `properties`.
- Update the tool's `description` to drop the reference to `transfer_private_to_public` (now generalized).

- [ ] **Step 2: Update tests**

In `packages/bridge/test/mcp/tools.test.ts`, the `bridge_swap` handler test currently passes `record`. Replace with a USDCX-style payload including `merkleProof`, or simply an ALEO payload omitting `record` and `merkleProof`.

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run packages/bridge/test/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/bridge/src/mcp/tools.ts packages/bridge/test/mcp/tools.test.ts
git commit -m "update bridge_swap MCP schema for asset-routed deposit"
```

---

## Task 7: Workspace-wide green

- [ ] **Step 1: Run typecheck workspace-wide**

Run: `pnpm typecheck`
Expected: PASS for `@veil/core`, `@veil/bridge`, `@veil/wallet-adapter`. Pre-existing failures in `apps/loyalty-dapp` and `apps/loyalty-node` are unrelated; do not investigate.

- [ ] **Step 2: Run tests workspace-wide**

Run: `pnpm vitest run`
Expected: all tests pass. The bridge package goes from 48 → ~55, the core package gains 11 new transfer tests.

- [ ] **Step 3: Push branch**

Run: `git push origin feat/bridge-client`
Expected: success; PR #61 picks up the new commits automatically.

---

## Out of scope (follow-ups)

- **Multi-hop swap action** (`shield → private hops → unshield` on outbound; mirror on inbound). Substantive feature; new PR on `feat/bridge-client`.
- **Compliance proof helpers** for USDCX/USAD merkle proofs. v1 callers provide proof strings; v2 ships a helper that derives them from on-chain state.
- **Token IDs for `token_registry.aleo` shield direction.** Not needed for swap (unshield only); needed if a future feature shields wrapped assets into Aleo from public balances.
- **Subscribe to additional EVM L2s** beyond Base/Arbitrum once the bridge supports them — config-only change.

---

## Self-Review Notes

- Existing 7 transfer tests preserved unchanged in Task 2.
- Existing swap tests get updated, not duplicated.
- `record` field is removed from `SwapParameters` (existing tests using it must be updated; no external callers yet).
- `transfer`'s extension keeps the credit.aleo default behavior bit-for-bit identical when callers don't supply the new optional knobs.
