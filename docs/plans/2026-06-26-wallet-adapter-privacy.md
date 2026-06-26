# Wallet Adapter Privacy-Preserving Dapps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the `@provablehq/*` `1.0.0` privacy-preserving dapps feature into Veil so dapps can use connect-time grants and `InputRequest`-based transaction inputs (address injection, record fulfillment, derived inputs) end-to-end.

**Architecture:** `@veil/core` owns local mirror types for the new shapes (no `@provablehq/*` in core/react public surface); the `@veil/wallet-adapter` and `@veil/react` shims map to `@provablehq/*` at the boundary. Input handling widens `string[]` → `TransactionInput[]` (`string | InputRequest`) through the contract/action layer; `InputRequest`s pass through un-encoded to the wallet and are rejected on the local-proving path.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, tsup. React for `@veil/react`.

**Spec:** `docs/specs/2026-06-26-wallet-adapter-privacy-design.md`

## Global Constraints

- Bump these to `1.0.0`: `@provablehq/aleo-types`, `@provablehq/aleo-wallet-standard`, `@provablehq/aleo-wallet-adaptor-{core,react,shield,leo,puzzle,fox}`. Do NOT touch `@provablehq/sdk`.
- All changes are additive widenings — no breaking changes. String inputs and existing call sites keep working.
- `@provablehq/*` types must NOT appear in `@veil/core` or `@veil/react` public type surfaces — only in the shim packages.
- Every new/edited public symbol gets JSDoc in the contributor voice (`.agents/contributors.md` / `.agents/voice.md`): verb-first summary, params documented by consequence, no `@param {type}` tags (TS carries types), `@example` where useful. Bring touched legacy docblocks (e.g. `writeContract`'s `@param {string[]}`) up to this voice.
- Completion bar (per `CLAUDE.md`): `pnpm vitest run` green from repo root AND `pnpm --filter @veil/loyalty-dapp exec tsc --noEmit` clean.
- Mirror types are field-for-field identical to upstream so the shim boundary is a cast, not a translation. Verify exact upstream `1.0.0` field names while implementing.
- Branch: `feat/wallet-adapter-update` (already rebased on main).

---

### Task 1: Bump dependencies to 1.0.0 and re-establish a green baseline

**Files:**
- Modify: `packages/core/package.json`, `packages/wallet-adapter/package.json`, `packages/react/package.json`
- Modify: `pnpm-lock.yaml` (via install)

**Interfaces:**
- Produces: all `@provablehq/*` (except `sdk`) at `1.0.0` across the workspace.

- [ ] **Step 1: Bump `@veil/core`**

In `packages/core/package.json`, `devDependencies`: `"@provablehq/aleo-types": "0.3.0-alpha.4"` → `"1.0.0"`.

- [ ] **Step 2: Bump `@veil/wallet-adapter`**

In `packages/wallet-adapter/package.json` `devDependencies`: set `@provablehq/aleo-types`, `@provablehq/aleo-wallet-adaptor-core`, `@provablehq/aleo-wallet-standard` all to `"1.0.0"`. Leave the `peerDependencies` `@provablehq/aleo-wallet-adaptor-core: "*"` as-is.

- [ ] **Step 3: Bump `@veil/react`**

In `packages/react/package.json` `dependencies`: set `@provablehq/aleo-wallet-adaptor-react`, `-shield`, `-leo`, `-puzzle`, `-fox`, `@provablehq/aleo-wallet-standard`, `@provablehq/aleo-types` all to `"1.0.0"`.

- [ ] **Step 4: Install**

Run: `pnpm install`
Expected: lockfile updates, no peer-dependency errors for the bumped packages.

- [ ] **Step 5: Baseline build + test**

Run: `pnpm vitest run`
Expected: PASS (the only type-level change is `TransactionOptions.inputs` widening, which is source-compatible; existing string-input code still compiles).

Run: `pnpm --filter @veil/loyalty-dapp exec tsc --noEmit`
Expected: clean.

If either fails, fix the fallout from the bump (e.g. a renamed import) before continuing — do not proceed to Task 2 on a red baseline.

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/wallet-adapter/package.json packages/react/package.json pnpm-lock.yaml
git commit -m "chore: bump @provablehq wallet packages to 1.0.0"
```

---

### Task 2: Core mirror types

**Files:**
- Create: `packages/core/src/types/inputRequest.ts`
- Create: `packages/core/src/types/inputRequest.test.ts`
- Modify: `packages/core/src/types/records.ts` (add `RecordView`, extend `OwnedRecordEncrypted`)
- Modify: `packages/core/src/index.ts` (export new types)

**Interfaces:**
- Produces: `TransactionInput`, `InputRequest`, `RecordFilters`, `RecordFieldFilter`, `AlgorithmArg`, `AlgorithmName`, `KNOWN_ALGORITHMS`, `ConnectOptions`, `RecordAccessGrant`, `ProgramGrant`, `RecordGrant`, `FieldGrant`, `AlgorithmGrant`, `ArgConstraint`, `RecordView`; functions `isInputRequest`, `assertNoInputRequests`; extended `OwnedRecordEncrypted` with `uid?`/`recordView?`. Consumed by Tasks 3, 4, 5.

- [ ] **Step 1: Create `packages/core/src/types/inputRequest.ts`**

```ts
// Wallet-fulfilled transaction inputs and connect-time privacy grants.
// Local mirrors of the Provable wallet-standard shapes (field-for-field), so
// @provablehq/* stays out of @veil/core's public surface.

/** Wallet-side derivation algorithms known to Veil; any string is also accepted. */
export const KNOWN_ALGORITHMS = [
  'program-scoped-blinding-factor',
  'program-scoped-blinded-address',
] as const

/** A known derivation algorithm name. */
export type KnownAlgorithm = (typeof KNOWN_ALGORITHMS)[number]

/** A derivation algorithm name — a known one, or any other string the wallet supports. */
export type AlgorithmName = KnownAlgorithm | (string & {})

/** Aleo type tag for a derived-input argument value (a literal type or "string"). */
export type ArgType = string

/**
 * One argument to a `derived` input's algorithm.
 *
 * @property type Aleo type tag for `value` (e.g. "address", "string").
 * @property value The argument, as an Aleo-encoded string.
 */
export interface AlgorithmArg {
  type: ArgType
  value: string
}

/**
 * Comparison filter for one record field, used to auto-select a record.
 *
 * @property eq Match records whose field equals this Aleo-encoded value.
 * @property neq Match records whose field does not equal this value.
 * @property gte Match records whose field is >= this value.
 * @property lte Match records whose field is <= this value.
 */
export interface RecordFieldFilter {
  eq?: string
  neq?: string
  gte?: string
  lte?: string
}

/** Field name → comparison filter, for wallet-side record auto-selection. */
export type RecordFilters = Record<string, RecordFieldFilter>

/**
 * A transaction input the wallet fulfils instead of the dapp, so private values
 * never reach the dapp.
 *
 * - `address`: the wallet injects its own active address into the slot.
 * - `record`: the wallet supplies an owned record — pinned by `uid` (from a
 *   prior `requestRecords`) or auto-selected by `filters`. `uid` and `filters`
 *   are mutually exclusive.
 * - `derived`: the wallet runs `algorithm` over its private state and substitutes
 *   the result.
 */
export type InputRequest =
  | { type: 'address'; label?: string }
  | {
      type: 'record'
      program: string
      recordname: string
      filters?: RecordFilters
      uid?: string
    }
  | {
      type: 'derived'
      algorithm: AlgorithmName
      args: Record<string, AlgorithmArg>
      label?: string
    }

/** A transaction input: an Aleo-encoded literal string, or a wallet-fulfilled request. */
export type TransactionInput = string | InputRequest

/** A single field-access grant within a record grant. */
export interface FieldGrant {
  name: string
  readAccess?: boolean
}

/** Grants access to specific records (and optionally fields) of a program. */
export interface RecordGrant {
  recordname: string
  fields?: FieldGrant[]
}

/** Grants record access scoped to one program. */
export interface ProgramGrant {
  program: string
  records?: RecordGrant[]
}

/** Connect-time record-access grant: deny all, or scope by program. */
export type RecordAccessGrant =
  | { level: 'none' }
  | { level: 'byProgram'; programs: ProgramGrant[] }

/** Constraint on a derived-algorithm argument: an allowlist of values, or "any". */
export type ArgConstraint = string[] | 'any'

/**
 * Connect-time authorization for one `derived` algorithm at a specific call site.
 *
 * @property algorithm The algorithm this grant authorizes.
 * @property program Program the algorithm may run for.
 * @property function Function the algorithm may run for.
 * @property inputPosition Input slot the derived value may fill.
 * @property argConstraints Optional per-argument allowlists.
 */
export interface AlgorithmGrant {
  algorithm: AlgorithmName
  program: string
  function: string
  inputPosition: number
  argConstraints?: Record<string, ArgConstraint>
}

/**
 * Connect-time privacy grants passed to a wallet's `connect`.
 *
 * @property recordAccess Which records/fields the dapp may read.
 * @property readAddress Whether the dapp may learn the address. Defaults to true;
 *   set false to transact without ever receiving it.
 * @property algorithmsAllowed Allowlist authorizing `derived` inputs; undefined
 *   means all derived inputs are refused.
 */
export interface ConnectOptions {
  recordAccess?: RecordAccessGrant
  readAddress?: boolean
  algorithmsAllowed?: AlgorithmGrant[]
}

/**
 * Narrows a transaction input to a wallet-fulfilled request.
 *
 * @param input A transaction input — a literal string or an InputRequest.
 * @returns True if the input is an InputRequest (address/record/derived).
 */
export function isInputRequest(input: TransactionInput): input is InputRequest {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input.type === 'address' || input.type === 'record' || input.type === 'derived')
  )
}

/**
 * Asserts that no input is wallet-fulfilled, narrowing to encoded strings.
 *
 * The local-proving path can only handle Aleo-encoded string inputs; address,
 * record, and derived requests require a wallet to resolve them.
 *
 * @param inputs The transaction inputs to check.
 * @throws If any input is an InputRequest — use a wallet (RPC) account instead.
 */
export function assertNoInputRequests(
  inputs: TransactionInput[],
): asserts inputs is string[] {
  if (inputs.some(isInputRequest)) {
    throw new Error(
      'Wallet-specified inputs (address/record/derived) require a wallet account. ' +
        'The local-proving path only accepts Aleo-encoded string inputs.',
    )
  }
}
```

- [ ] **Step 2: Add `RecordView` and extend the record type in `packages/core/src/types/records.ts`**

Add before `OwnedRecordEncrypted`:

```ts
/**
 * The granted, decrypted view of a record's contents.
 *
 * Populated by a privacy-preserving wallet with only the fields the connection's
 * recordAccess grant permits; ungranted fields are omitted. Values are
 * Aleo-encoded strings.
 *
 * @property fields Granted field key → Aleo-encoded value string. Keys may be a
 *   record-body field name, a dotted struct path ("data.amount"), or a
 *   `$`-prefixed metadata token ("$commitment").
 */
export interface RecordView {
  fields: Record<string, string>
}
```

Then add these two fields to the `OwnedRecordEncrypted` interface (alongside the existing fields):

```ts
  /** Opaque per-connection handle from a privacy-preserving wallet; pass back as a record InputRequest `uid`. */
  uid?: string
  /** Granted plaintext fields when the wallet withholds full plaintext under a recordAccess grant. */
  recordView?: RecordView
```

- [ ] **Step 3: Export from `packages/core/src/index.ts`**

Add `RecordView` to the `from './types/records.js'` export block (after `OwnedRecordEncrypted`):

```ts
  OwnedRecord,
  OwnedRecordEncrypted,
  RecordView,
  RecordStatusFilter,
```

Add a new export block (next to the other type exports, e.g. after the `./types/contract.js` block):

```ts
export type {
  TransactionInput, InputRequest, RecordFilters, RecordFieldFilter,
  AlgorithmArg, AlgorithmName, KnownAlgorithm, ArgType, ArgConstraint,
  ConnectOptions, RecordAccessGrant, ProgramGrant, RecordGrant, FieldGrant, AlgorithmGrant,
} from './types/inputRequest.js'
export { KNOWN_ALGORITHMS, isInputRequest, assertNoInputRequests } from './types/inputRequest.js'
```

- [ ] **Step 4: Write the test**

Create `packages/core/src/types/inputRequest.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isInputRequest, assertNoInputRequests, type TransactionInput } from './inputRequest.js'

describe('isInputRequest', () => {
  it('returns false for literal string inputs', () => {
    expect(isInputRequest('100u64')).toBe(false)
    expect(isInputRequest('aleo1abc')).toBe(false)
  })

  it('returns true for address/record/derived requests', () => {
    expect(isInputRequest({ type: 'address' })).toBe(true)
    expect(isInputRequest({ type: 'record', program: 'credits.aleo', recordname: 'credits', uid: 'u1' })).toBe(true)
    expect(isInputRequest({ type: 'derived', algorithm: 'program-scoped-blinding-factor', args: {} })).toBe(true)
  })
})

describe('assertNoInputRequests', () => {
  it('passes for all-string inputs', () => {
    const inputs: TransactionInput[] = ['100u64', 'aleo1abc']
    expect(() => assertNoInputRequests(inputs)).not.toThrow()
  })

  it('throws when any input is a request', () => {
    const inputs: TransactionInput[] = ['100u64', { type: 'address' }]
    expect(() => assertNoInputRequests(inputs)).toThrow(/require a wallet account/)
  })
})
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @veil/core vitest run src/types/inputRequest.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types/inputRequest.ts packages/core/src/types/inputRequest.test.ts packages/core/src/types/records.ts packages/core/src/index.ts
git commit -m "feat(core): add InputRequest/grant mirror types and RecordView"
```

---

### Task 3: Core input handling (widen + passthrough + local-proving guard)

**Files:**
- Modify: `packages/core/src/contract/getContract.ts` (`resolveInputs`, param types)
- Modify: `packages/core/src/types/inference.ts` (`WriteParams`/`SimulateParams`/`ExecuteParams`)
- Modify: `packages/core/src/actions/wallet/writeContract.ts`
- Modify: `packages/core/src/actions/wallet/executeContract.ts`
- Modify: `packages/core/src/actions/wallet/simulateContract.ts`
- Create: `packages/core/src/contract/resolveInputs.test.ts`

**Interfaces:**
- Consumes: `TransactionInput`, `InputRequest`, `isInputRequest`, `assertNoInputRequests` (Task 2).
- Produces: contract/action input params accept `(InputValue | InputRequest)[]` / `TransactionInput[]`; `InputRequest`s pass through encoding and reach the transport; local-proving paths reject them.

- [ ] **Step 1: Widen the raw action param types and guard local paths**

`packages/core/src/actions/wallet/writeContract.ts`:
- Add import: `import { assertNoInputRequests } from '../../types/inputRequest.js'` and `import type { TransactionInput } from '../../types/inputRequest.js'`.
- Change `inputs: string[]` → `inputs: TransactionInput[]` in `WriteContractParameters`.
- Replace the legacy docblock with voice-compliant JSDoc (no `@param {type}` tags). Document `inputs` by consequence: "Function inputs: Aleo-encoded literal strings, or InputRequest objects the wallet fulfils (address/record/derived). InputRequests require a wallet (RPC) account."
- In the `account.type === 'local'` branch, before building the transaction: `assertNoInputRequests(params.inputs)`. (After the assert, `params.inputs` is `string[]` for the proving payload.)
- The `account.type === 'rpc'` branch passes `params.inputs` through unchanged (the transport carries `TransactionInput[]`).

`packages/core/src/actions/wallet/executeContract.ts`:
- Same import. `inputs: string[]` → `inputs: TransactionInput[]`.
- In the `account.type === 'local'` branch, before `client.proving.execute(...)`: `assertNoInputRequests(params.inputs)`.
- RPC branch passes through unchanged.

`packages/core/src/actions/wallet/simulateContract.ts`:
- Same import. `inputs: string[]` → `inputs: TransactionInput[]`.
- `simulate` is local-only; in the `account.type === 'local'` branch, before `client.proving.simulate(...)`: `assertNoInputRequests(params.inputs)`.

- [ ] **Step 2: Widen `inference.ts` param types**

`packages/core/src/types/inference.ts` lines ~101-103: change each of `SimulateParams` / `ExecuteParams` / `WriteParams` `inputs: InputValue[]` → `inputs: (InputValue | InputRequest)[]`, and add `import type { InputRequest } from './inputRequest.js'`.

- [ ] **Step 3: Widen `getContract` params and `resolveInputs`**

`packages/core/src/contract/getContract.ts`:
- Add imports: `import { isInputRequest } from '../types/inputRequest.js'` and `import type { InputRequest, TransactionInput } from '../types/inputRequest.js'`. Add `getInputTypes` to the existing import from `'../utils/records.js'`.
- Change `ContractWriteParams`, `ContractSimulateParams`, `ContractExecuteParams` `inputs: InputValue[]` → `inputs: (InputValue | InputRequest)[]`.
- Replace `resolveInputs` with the version below (keeps the existing fast path; adds per-position passthrough when any request is present):

```ts
  /** Auto-encode inputs: native JS values → Aleo strings. InputRequests pass through un-encoded. */
  function resolveInputs(values: (InputValue | InputRequest)[], fnName: string): TransactionInput[] {
    const legacyFn = (abi as Program | undefined)?.functions.find((f) => f.name === fnName)

    const encodeOne = (value: InputValue, i: number): string => {
      if (typeof value === 'object' && value !== null && 'owner' in value && 'fields' in value) {
        return serializeRecord(value as RecordValue)
      }
      if (typeof value === 'string') return value
      if (typeof value === 'boolean') return String(value)
      if (typeof value === 'bigint' || typeof value === 'number') {
        const type = legacyFn?.inputs[i]?.type as Primitive | undefined
        if (type) return encodeValue(typeof value === 'number' ? BigInt(value) : value, type)
        return String(value)
      }
      return String(value)
    }

    // Fast path: no wallet-fulfilled requests — encode exactly as before.
    if (!values.some(isInputRequest)) {
      if (resolvedAbi) return encodeInputs(values as InputValue[], resolvedAbi, fnName)
      return (values as InputValue[]).map(encodeOne)
    }

    // Mixed path: pass requests through untouched; encode each literal at its position.
    const types = resolvedAbi ? getInputTypes(resolvedAbi, fnName) : undefined
    return values.map((value, i) => {
      if (isInputRequest(value)) return value
      if (types) return encodeInputs([value as InputValue], [types[i]])[0]
      return encodeOne(value as InputValue, i)
    })
  }
```

(The proxy call sites `walletClient.writeContract({ inputs: resolveInputs(...) })` etc. now pass `TransactionInput[]`, which the widened action params accept.)

- [ ] **Step 4: Write the test**

Create `packages/core/src/contract/resolveInputs.test.ts`. This exercises `resolveInputs` through `getContract().write` against a mock wallet client that records what inputs it receives:

```ts
import { describe, expect, it, vi } from 'vitest'
import { getContract } from './getContract.js'
import type { InputRequest } from '../types/inputRequest.js'

function mockWalletClient() {
  const writeContract = vi.fn().mockResolvedValue('at1tx')
  return { client: { writeContract } as any, writeContract }
}

describe('resolveInputs passthrough (no ABI / legacy)', () => {
  it('encodes literals and passes InputRequests through untouched', async () => {
    const { client, writeContract } = mockWalletClient()
    const c = getContract({ program: 'credits.aleo', client })

    const recReq: InputRequest = { type: 'record', program: 'credits.aleo', recordname: 'credits', uid: 'u1' }
    await c.write.transfer_private({ inputs: [recReq, { type: 'address' }, '100u64'] })

    expect(writeContract).toHaveBeenCalledTimes(1)
    const sent = writeContract.mock.calls[0][0].inputs
    expect(sent[0]).toEqual(recReq)            // request object preserved, not stringified
    expect(sent[1]).toEqual({ type: 'address' })
    expect(sent[2]).toBe('100u64')             // literal preserved
  })

  it('encodes a pure-literal call the same as before (fast path)', async () => {
    const { client, writeContract } = mockWalletClient()
    const c = getContract({ program: 'credits.aleo', client })
    await c.write.transfer_public({ inputs: ['aleo1abc', '100u64'] })
    expect(writeContract.mock.calls[0][0].inputs).toEqual(['aleo1abc', '100u64'])
  })
})
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @veil/core vitest run src/contract/resolveInputs.test.ts src/types/inputRequest.test.ts`
Expected: PASS.

Run: `pnpm --filter @veil/core vitest run`
Expected: PASS (no regressions in existing core tests from the widening).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/contract/getContract.ts packages/core/src/types/inference.ts packages/core/src/actions/wallet/writeContract.ts packages/core/src/actions/wallet/executeContract.ts packages/core/src/actions/wallet/simulateContract.ts packages/core/src/contract/resolveInputs.test.ts
git commit -m "feat(core): carry InputRequest through inputs; reject on local proving"
```

---

### Task 4: `@veil/wallet-adapter` transport

**Files:**
- Modify: `packages/wallet-adapter/src/index.ts`
- Create: `packages/wallet-adapter/src/index.test.ts` (if no test file exists; otherwise extend it)

**Interfaces:**
- Consumes: `TransactionInput` (Task 2) for the inputs passthrough.
- Produces: transport forwards `InputRequest` inputs to `adapter.executeTransaction`; `algorithmsSupported` wired; `uid`/`recordView` surfaced from `requestRecords`.

- [ ] **Step 1: Pass inputs through in `executeTransaction`**

In `packages/wallet-adapter/src/index.ts`, `transportFromAdapter`'s `executeTransaction` case: change
`inputs: p?.inputs as string[],` → `inputs: p?.inputs as TransactionInput[],`
and add the import `import type { TransactionInput } from '@provablehq/aleo-types'` (the upstream `TransactionInput`, structurally identical to core's mirror). The request objects now reach `adapter.executeTransaction` unchanged.

- [ ] **Step 2: Add `algorithmsSupported`**

- Add to the `AleoWalletAdapter` interface:
```ts
  /** List the derived-input algorithms this wallet supports. Empty if none. */
  algorithmsSupported(): Promise<string[]>
```
- Add a transport case:
```ts
        case 'algorithmsSupported': {
          return adapter.algorithmsSupported()
        }
```

- [ ] **Step 3: Document address-withholding on the affected methods**

On the `AleoWalletAdapter` interface, extend the docblocks of `decrypt`, `requestRecords`, `transitionViewKeys`, and `requestTransactionHistory` to note: "Throws `WalletAddressWithheldError` when the connection was made with `readAddress: false`." (Voice: state the consequence, no hedging.)

- [ ] **Step 4: Test inputs passthrough + algorithmsSupported**

Add to `packages/wallet-adapter/src/index.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { transportFromAdapter } from './index.js'

function mockAdapter() {
  return {
    account: { address: 'aleo1abc' },
    connected: true,
    network: 'testnet',
    executeTransaction: vi.fn().mockResolvedValue({ transactionId: 'at1tx' }),
    algorithmsSupported: vi.fn().mockResolvedValue(['program-scoped-blinding-factor']),
  } as any
}

describe('transportFromAdapter', () => {
  it('forwards InputRequest inputs to the adapter unchanged', async () => {
    const adapter = mockAdapter()
    const transport = transportFromAdapter(adapter)
    const recReq = { type: 'record', program: 'amm_v3.aleo', recordname: 'credits', uid: 'u1' }

    await transport.request({
      method: 'executeTransaction',
      params: { programName: 'amm_v3.aleo', functionName: 'swap_private', inputs: [recReq, { type: 'address' }, '100u64'] },
    } as any)

    const opts = adapter.executeTransaction.mock.calls[0][0]
    expect(opts.inputs[0]).toEqual(recReq)
    expect(opts.inputs[1]).toEqual({ type: 'address' })
    expect(opts.inputs[2]).toBe('100u64')
  })

  it('wires algorithmsSupported', async () => {
    const adapter = mockAdapter()
    const transport = transportFromAdapter(adapter)
    const result = await transport.request({ method: 'algorithmsSupported', params: {} } as any)
    expect(result).toEqual(['program-scoped-blinding-factor'])
  })
})
```

(Note: `transport.request` is the `custom` transport's request fn; confirm the access path matches how `custom()` exposes it — adapt if it's `transport.config.request` or similar.)

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @veil/wallet-adapter vitest run`
Expected: PASS.
Run: `pnpm --filter @veil/wallet-adapter exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/wallet-adapter/src/index.ts packages/wallet-adapter/src/index.test.ts
git commit -m "feat(wallet-adapter): pass InputRequest inputs through; add algorithmsSupported"
```

---

### Task 5: `@veil/react` connect grants

**Files:**
- Modify: `packages/react/src/provider.tsx`
- Create: `packages/react/src/provider.test.tsx`

**Interfaces:**
- Consumes: `RecordAccessGrant`, `AlgorithmGrant` (Task 2, via `@veil/core`).
- Produces: `VeilProvider` forwards `recordAccess`/`readAddress`/`algorithmsAllowed` to `AleoWalletProvider`.

- [ ] **Step 1: Add grant props and forward them**

In `packages/react/src/provider.tsx`:
- Import the grant types from core: `import type { RecordAccessGrant, AlgorithmGrant } from '@veil/core'`.
- Add to `VeilProviderProps`:
```ts
  /** Connect-time record/field access grant (privacy-preserving wallets). */
  recordAccess?: RecordAccessGrant
  /** If false, transact without the dapp learning the address. Defaults to true. */
  readAddress?: boolean
  /** Allowlist authorizing `derived` transaction inputs. */
  algorithmsAllowed?: AlgorithmGrant[]
```
- Destructure them in the component signature and forward to `<AleoWalletProvider>`:
```tsx
      recordAccess={recordAccess}
      readAddress={readAddress}
      algorithmsAllowed={algorithmsAllowed}
```
(If TS complains the upstream prop types differ nominally from the core mirrors, cast at this boundary — the shim is where `@provablehq/*` coupling is allowed. Confirm the upstream prop names match `recordAccess`/`readAddress`/`algorithmsAllowed`.)

- [ ] **Step 2: Test forwarding**

Create `packages/react/src/provider.test.tsx`. Mock `@provablehq/aleo-wallet-adaptor-react` so the test asserts the props reach `AleoWalletProvider`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const captured: any = {}
vi.mock('@provablehq/aleo-wallet-adaptor-react', () => ({
  AleoWalletProvider: (props: any) => { Object.assign(captured, props); return props.children },
}))
// Stub the adapter classes so construction doesn't touch browser APIs.
vi.mock('@provablehq/aleo-wallet-adaptor-shield', () => ({ ShieldWalletAdapter: class {} }))
vi.mock('@provablehq/aleo-wallet-adaptor-leo', () => ({ LeoWalletAdapter: class {} }))
vi.mock('@provablehq/aleo-wallet-adaptor-puzzle', () => ({ PuzzleWalletAdapter: class {} }))
vi.mock('@provablehq/aleo-wallet-adaptor-fox', () => ({ FoxWalletAdapter: class {} }))

import { VeilProvider } from './provider.js'

describe('VeilProvider', () => {
  it('forwards privacy grant props to AleoWalletProvider', () => {
    render(
      <VeilProvider
        network="testnet"
        recordAccess={{ level: 'byProgram', programs: [{ program: 'credits.aleo' }] }}
        readAddress={false}
        algorithmsAllowed={[{ algorithm: 'program-scoped-blinded-address', program: 'amm_v3.aleo', function: 'swap_private', inputPosition: 2 }]}
      >
        <div />
      </VeilProvider>,
    )
    expect(captured.readAddress).toBe(false)
    expect(captured.recordAccess).toEqual({ level: 'byProgram', programs: [{ program: 'credits.aleo' }] })
    expect(captured.algorithmsAllowed).toHaveLength(1)
  })
})
```

(If `@testing-library/react` is not already a dev dependency of `@veil/react`, add it. Confirm the repo's React test setup; adapt the render import if a different harness is in use.)

- [ ] **Step 3: Run tests + typecheck**

Run: `pnpm --filter @veil/react vitest run`
Expected: PASS.
Run: `pnpm --filter @veil/react exec tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/provider.tsx packages/react/src/provider.test.tsx packages/react/package.json
git commit -m "feat(react): forward connect-time privacy grants on VeilProvider"
```

---

### Task 6: Example + full green verification

**Files:**
- Modify: `examples/dapp-wallet-adapter.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Add a privacy-features demo to `examples/dapp-wallet-adapter.ts`**

Extend the existing example (it already mocks `fromWalletAdapter`/`requestRecords`) with a section that:
1. reads records and takes a `uid`:
```ts
const records = await walletClient.requestRecords('credits.aleo', true, 'unspent')
const rec = records[0]
```
2. composes a privacy transaction using the three request forms:
```ts
const txId = await walletClient.writeContract({
  program: 'credits.aleo',
  function: 'transfer_private',
  inputs: [
    { type: 'record', program: 'credits.aleo', recordname: 'credits', uid: rec.uid! },
    { type: 'address' },
    '100u64',
  ],
})
```
Keep the existing mock-adapter style; assert (vitest `expect`) that the mock adapter's `executeTransaction` received the `InputRequest` objects unchanged. Add brief comments explaining address injection, uid pinning, and the filters alternative. Documentation/comments follow the contributor voice.

- [ ] **Step 2: Full repo verification (completion bar)**

Run: `pnpm vitest run`
Expected: PASS (all packages + examples).

Run: `pnpm --filter @veil/loyalty-dapp exec tsc --noEmit`
Expected: clean.

If the dApp fails to typecheck due to the bump or widening, fix it in `apps/loyalty-dapp` and include those files in the commit (per the keep-in-sync constraint).

- [ ] **Step 3: Commit**

```bash
git add examples/dapp-wallet-adapter.ts
# include apps/loyalty-dapp/* if changes were needed
git commit -m "docs(examples): demo privacy-preserving inputs via the wallet adapter"
```

---

## Self-Review

**Spec coverage:**
- Mirror types (InputRequest/grants/RecordView), no @provablehq in core surface → Task 2. ✓
- Extend OwnedRecord(Encrypted) with uid/recordView, no duplicate envelope → Task 2. ✓
- Core input widening + resolveInputs passthrough + local-proving guard → Task 3. ✓
- wallet-adapter inputs passthrough + algorithmsSupported + address-withheld docs → Task 4. ✓
- react VeilProvider grant props → Task 5. ✓
- Dep bump to 1.0.0 across core/wallet-adapter/react, sdk untouched → Task 1. ✓
- Examples demo + dApp typecheck + green vitest → Task 6 (+ baseline in Task 1). ✓
- Backwards-compat (additive), doc-voice on touched symbols → Global Constraints + per-task notes. ✓

**Placeholder scan:** No TBD/TODO. Code is inline for new files; edits show exact before/after or precise location. Two flagged confirmations (the `custom()` transport request access path in Task 4 Step 4; upstream prop names in Task 5 Step 1) are verification notes, not placeholders — the surrounding code is complete.

**Type consistency:** `TransactionInput`/`InputRequest`/`isInputRequest`/`assertNoInputRequests` defined in Task 2 are used with the same names/signatures in Tasks 3–4. `RecordView` defined and exported in Task 2, referenced in Task 2's `OwnedRecordEncrypted`. Grant types (`RecordAccessGrant`/`AlgorithmGrant`) defined in Task 2, consumed in Task 5.

**Out of scope (confirm not added):** No `recordInput` helper (dropped). No DEX-specific derived-input builders. No `@provablehq/sdk` bump.
