# Veil Contract API Design

## Contents

- [Context](#context)
- [Foundation: The Type System](#foundation-the-type-system)
- [Design Principles](#design-principles)
- [Contract Instance](#contract-instance)
- [Reading State](#reading-state)
- [Executing Programs](#executing-programs)
- [ABI-Driven Type Inference](#abi-driven-type-inference)
- [Records & Private State](#records--private-state)
- [Cross-Program Calls](#cross-program-calls)
- [Proving Configuration](#proving-configuration)
- [Fee Handling](#fee-handling)
- [Finalize Awareness](#finalize-awareness)
- [Error Handling](#error-handling)
- [Client Architecture](#client-architecture)
- [Standalone Actions](#standalone-actions)
- [React & Node Consumption](#react--node-consumption)
- [Out of Scope](#out-of-scope)
- [Comparison: Veil vs Viem](#comparison-veil-vs-viem)
- [Open Design Questions](#open-design-questions)

---

## Context

This document proposes the contract API for Veil — Aleo's standard interface library, inspired by viem (Ethereum). The design is informed by:
- Building a POC loyalty template that went from 1280 → 356 lines using Veil
- Deep analysis of viem's contract API (getContract, readContract, writeContract, simulateContract, events, multicall)
- Analysis of Aleo's unique execution model (records, ZK proving, finalize, privacy)

The goal: define the API that dApp developers, agents, and React/Node.js consumers interact with.

---

## Foundation: The Type System

Veil's type system mirrors the Leo compiler's `leo-abi-types` crate, so TypeScript consumers see the same structure the compiler emits. These types live in `packages/core/src/types/` and form the foundation everything else builds on.

### Primitive types (`types/primitives.ts`)

```ts
// Every primitive Aleo type
type Primitive =
  | 'address' | 'boolean' | 'field' | 'group' | 'identifier'
  | 'scalar' | 'signature'
  | 'u8' | 'u16' | 'u32' | 'u64' | 'u128'
  | 'i8' | 'i16' | 'i32' | 'i64' | 'i128'

// A plaintext type descriptor — primitive, array, struct ref, or optional
type Plaintext =
  | { kind: 'primitive'; primitive: Primitive }
  | { kind: 'array'; element: Plaintext; length: number }
  | { kind: 'struct'; path: string[]; program?: string }
  | { kind: 'optional'; inner: Plaintext }

// Runtime values — precisely typed
type U8 = number      // fits in JS number
type U64 = bigint     // requires bigint
type Literal = Address | boolean | Field | U8 | ... | U128

type PlaintextValue = Literal | StructValue | ArrayValue

type RecordValue = {
  owner: Address
  fields: { [name: string]: { value: PlaintextValue; mode: 'public' | 'private' } }
  nonce: string
  toString(): string   // serializes back to "{ owner: aleo1...private, points: 1000u64.private, ... }"
}

type FutureValue = {
  programId: string
  function: string
  arguments: (FutureValue | PlaintextValue)[]
}
```

### ABI schema types (`types/abi.ts`)

```ts
type Mode = 'none' | 'constant' | 'private' | 'public'

type FunctionInput =
  | { kind: 'plaintext'; type: Plaintext }
  | { kind: 'record'; path: string[]; program?: string }
  | { kind: 'dynamicRecord' }

type FunctionOutput =
  | { kind: 'plaintext'; type: Plaintext }
  | { kind: 'record'; path: string[]; program?: string }
  | { kind: 'dynamicRecord' }
  | { kind: 'final' }           // async finalize handle

type AbiFunction = {
  name: string
  isFinal: boolean              // true if function has a finalize block
  inputs: Input[]
  outputs: Output[]
}

type ABI = {
  program: string
  structs: StructDef[]
  records: RecordDef[]
  mappings: Mapping[]
  storageVariables: StorageVariable[]
  functions: AbiFunction[]
}
```

### Parsing (`utils/parseAbi.ts`, `utils/parsePrimitives.ts`)

- `parseAbi(json)` — converts Leo's `leo abi <program>` output to `ABI`
- `parsePlaintext(raw)` — converts Leo JSON plaintext descriptor to `Plaintext`
- `parsePrimitive(raw)` — converts Leo JSON primitive to `Primitive`

**This is the canonical entry point** for ABIs in Veil. Everything else builds on these types.

---

## Design Principles

1. **Familiarity** — Developers coming from viem/wagmi should recognize the patterns
2. **Privacy-first** — Records, decryption, and proving are first-class
3. **Mode-transparent** — Same contract call works locally, with delegated proving, or through a wallet
4. **ABI-driven** — The compiler's `abi.json` (parsed via `parseAbi`) powers validation, encoding, and type inference
5. **Layered** — Core is zero-dependency; SDK/proving/wallet adapters plug in

---

## Contract Instance

```ts
import { getContract, parseAbi } from '@veil/core'
import tokenAbi from './loyalty_token/build/abi.json' with { type: 'json' }

// Minimal — Veil auto-resolves imports from the chain
const contract = getContract({
  program: 'loyalty_token.aleo',
  abi: parseAbi(tokenAbi),
  programSource: tokenSource,       // needed for proving
  publicClient,
  walletClient,
})

// With manual import overrides (for local/undeployed programs or pinning a specific edition)
const contract = getContract({
  program: 'loyalty_rewards.aleo',
  abi: parseAbi(rewardsAbi),
  programSource: rewardsSource,
  imports: {                         // optional — overrides auto-resolution
    'loyalty_token.aleo': { abi: parseAbi(tokenAbi), programSource: tokenSource },
  },
  publicClient,
  walletClient,
})
```

**Import resolution** (default behavior): Veil walks the ABI's import references (`FunctionInput`/`FunctionOutput` with `program` fields) and auto-resolves each imported program's ABI and source from the chain. ABIs are available via the explorer API (generated from blockchain history); source is fetched via `publicClient.getCode()`. Manual `imports` overrides this for undeployed programs, local development, or edition pinning.

### Namespaces

| Namespace | Requires | Description | viem equivalent |
|-----------|----------|-------------|-----------------|
| `read` | `publicClient` | Read mapping values | `read` (view functions) |
| `execute` | `walletClient` | Build, prove, broadcast, wait, return parsed outputs | `write` + `waitForTransactionReceipt` |
| `simulate` | `walletClient` | Local execution, no broadcast, return parsed outputs | `simulateContract` |
| `write` | `walletClient` | Build + broadcast, return tx ID only | `writeContract` |
| `estimateFee` | `publicClient` | Fee estimation | `estimateGas` |
| `fetchAbi` | `publicClient` | Fetch and parse on-chain program source | N/A |

### Why `execute` exists (no direct viem equivalent)

In viem, `writeContract` returns a tx hash and you call `waitForTransactionReceipt` separately. In Aleo, transaction outputs are **encrypted records** that the caller may or may not be able to decrypt — you can't just read logs from a receipt. `execute` handles the full lifecycle:

1. Build proving request (authorization + fee)
2. Prove (locally or via DPS)
3. Broadcast transaction
4. Wait for on-chain confirmation
5. Extract outputs per transition (a single tx can have multiple transitions)
6. Apply decryption policy — decrypt records we own, leave others as `EncryptedRecord`
7. Parse into typed `RecordValue` / `PlaintextValue` / `FutureValue` using the ABI

In local mode, `execute` falls back to `simulate`. Same code works in both modes.

---

## Reading State

### Mapping reads

```ts
// Read a public mapping value — ABI tells us the value type
const balance = await contract.read.account({ key: 'aleo1...' })
// balance: bigint (U64, inferred from ABI mapping value type — see TS inference section)

// Standalone
const balance = await publicClient.readContract({
  program: 'credits.aleo',
  mapping: 'account',
  key: 'aleo1...',
})
```

**Aleo vs EVM:** In EVM, `readContract` calls view/pure functions. In Aleo, there are no view functions — reads are mapping lookups. Functions always require proving. This is fundamental: Aleo's `read` is simpler (key-value) but more limited (no computed reads).

### Batch reads (future)

```ts
// Proposed — parallelized HTTP requests (no on-chain Multicall3 equivalent needed)
const results = await publicClient.multiread({
  reads: [
    { program: 'credits.aleo', mapping: 'account', key: addr1 },
    { program: 'credits.aleo', mapping: 'account', key: addr2 },
  ],
})
```

---

## Executing Programs

### Output shape: per-transition, decryption-aware

A single Aleo transaction can contain **multiple transitions** — the called function can invoke other functions in a chain, each producing its own outputs. Veil preserves this structure so callers can trace which transition produced which output.

```ts
type ExecuteResult = {
  transactionId: string        // empty in local mode (no broadcast)
  transitions: TransitionResult[]
}

type TransitionResult = {
  transitionId: string
  program: string              // e.g. 'loyalty_token.aleo'
  function: string             // e.g. 'mint_card'
  outputs: Output[]
}

type Output =
  | RecordValue                // decrypted (we own it and decryption enabled)
  | EncryptedRecord            // still encrypted (not ours, or decryption disabled)
  | PlaintextValue             // public primitive / struct / array
  | FutureValue                // finalize handle

type EncryptedRecord = {
  kind: 'encryptedRecord'
  ciphertext: string           // the on-chain record1...
  commitment: string
  program: string              // which program's record type
  recordName: string           // which record type (from ABI path)
}
```

`result.outputs` returns the **top-level function's** outputs (what the called function declared in its ABI). `result.transitions` gives the full call chain when you need to trace internal cross-program calls.

```ts
const result = await contract.execute.redeem_points_for_voucher({ inputs: [...] })
result.outputs                  // outputs of redeem_points_for_voucher specifically (card + voucher)
result.transitions              // full list: [spend_points transition, redeem_points_for_voucher transition]
result.transitions[0].outputs   // outputs from the internal spend_points call
```

### Decryption policy

Only owned records are ever decryptable — if you don't own a record, it stays as `EncryptedRecord` regardless. The real question is whether the dApp has **permission** to decrypt, which is set at wallet connect-time.

The wallet adapter standard already defines `WalletDecryptPermission` levels:
- `NoDecrypt` — dApp cannot decrypt any records
- `UponRequest` — dApp can decrypt records when it asks (wallet prompts user)
- `AutoDecrypt` — dApp can auto-decrypt any requested records
- `ViewKeyAccess` — dApp can request on-chain record plaintext and transaction IDs but cannot decrypt

Veil respects whatever permission level the wallet grants. For local accounts (no wallet), all owned records are decrypted by default.

> The full decrypt permission model and its interaction with RecordRef is being specified in a separate ARC (RecordRef + decrypt permissions). This spec defers to that document for the detailed permission design.

### execute — full lifecycle (recommended)

```ts
const result = await contract.execute.mint_card({
  inputs: [recipient, 1000n, 42n],    // auto-encoded via ABI types
  fee: 10000n,                         // optional, auto-estimated if omitted
  privateFee: false,                   // pay from record or public balance
})

// result.transactionId — the on-chain tx ID (empty in local mode)
// result.transitions    — full call chain (all transitions including internal cross-program calls)
// result.outputs        — the top-level function's outputs only (what this function returns per its ABI)

// Example output structure for mint_card:
// {
//   transactionId: 'at1...',
//   transitions: [
//     {
//       transitionId: 'au1...',
//       program: 'loyalty_token.aleo',
//       function: 'mint_card',
//       outputs: [
//         { owner: 'aleo1...', fields: { points: {...}, tier: {...} }, nonce: '...' },  // RecordValue
//         { programId: 'loyalty_token.aleo', function: 'mint_card', arguments: [...] }, // FutureValue
//       ],
//     },
//   ],
// }
```

**Behavior by account type:**

The choice between `local` and `delegated` proving is meaningful only when veil is doing the proving itself (local accounts using `@veil/provable`, or SDK provider integrations). With wallets (`rpc` accounts), the wallet handles proving however it chooses internally and veil does not influence it.

*Local accounts or SDK providers*
- `local` — Builds the transaction locally (proves on this machine via WASM), broadcasts to the network, waits for confirmation, applies decryption policy, returns parsed result.
- `delegated` — Submits the proving request to DPS, waits for on-chain confirmation, extracts outputs, applies decryption policy, returns parsed result.

*Standard wallets (RPC accounts)*
- `rpc` — Delegates the entire flow to the connected wallet. The wallet decides whether to prove locally or via its own delegated proving service. Veil passes `decrypt` as a hint; the wallet has final say on decryption.

> Note: `simulate` is always local and never broadcasts, regardless of account type. See the simulate section below.

### simulate — always local

```ts
const result = await contract.simulate.mint_card({
  inputs: [recipient, 1000n, 42n],
})
```

Always runs locally regardless of proving mode. Useful for testing, validation, and UX previews. Same return shape as `execute`.

**Availability:** `simulate` requires veil to control proving (local accounts or SDK providers). Standard web wallets do not expose a dry run interface, so `simulate` is **not available** when the account type is `rpc`. Calling it on an rpc account throws `SimulateNotSupportedError`.

### write — low-level fire-and-forget

```ts
const txId = await contract.write.mint_card({
  inputs: [recipient, 1000n, 42n],
  fee: 10000n,
})

// Poll for status — returns the transaction object (or reduced representation)
const tx = await walletClient.transactionStatus(txId)
// tx contains the full transaction with transitions and outputs for manual extraction
```

Returns tx ID only. For custom transaction lifecycle management (e.g., batch submission, custom indexing). Pair with `transactionStatus` to poll for confirmation and retrieve the transaction object for output extraction.

> Note: `transactionStatus` should return the transaction object (or a reduced representation) rather than just a status string, so `write` users can extract and parse outputs without a separate `getTransaction` call.

---

## ABI-Driven Type Inference

### Input encoding

The ABI's `FunctionInput` types drive auto-encoding:

```ts
// ABI says: inputs = [
//   { kind: 'plaintext', type: { kind: 'primitive', primitive: 'address' } },
//   { kind: 'plaintext', type: { kind: 'primitive', primitive: 'u64' } },
//   { kind: 'plaintext', type: { kind: 'primitive', primitive: 'field' } },
// ]

contract.execute.mint_card({ inputs: ['aleo1...', 1000n, 42n] })
// Encoded to: ["aleo1...", "1000u64", "42field"]
```

For record inputs (consuming a record), pass either a `RecordValue` (Veil serializes it to plaintext) or the raw plaintext string directly. The ABI's `FunctionInput.kind === 'record'` tells Veil how to handle it.

`RecordValue` provides a `toString()` method that serializes fields back to the Aleo record plaintext format. Follows standard JS/SnarkVM conventions — the data is already plaintext (just in object form), so `toString()` is more accurate than `toPlaintext()` which would imply decryption.

### Output parsing

Aleo output parsing is more involved than EVM's `returns` model. A single transaction can contain multiple transitions, each producing multiple outputs of mixed kinds (records we own, records owned by others, public plaintext values, finalize handles). The ABI's `FunctionOutput` types drive auto-parsing for each.

#### Per-output parsing

For each output, Veil consults the `FunctionOutput` to decide how to parse it:

```ts
// ABI says output = { kind: 'record', path: ['LoyaltyCard'], program: 'loyalty_token' }
// Veil looks up the RecordDef from abi.records and parses fields by their declared types

const output = outputs[0]  // RecordValue
output.fields.points.value  // bigint (U64)
output.fields.tier.value    // number (U8)
output.fields.owner.value   // string (Address)
```

#### Cross program record outputs

When a function output is a record from another program (e.g., `loyalty_rewards.redeem_points_for_voucher` returns a `LoyaltyCard` from `loyalty_token`), Veil resolves the `RecordDef` from the imported program's ABI. By default this is auto-resolved from the explorer API; manual `imports` overrides for local/undeployed programs.

```ts
// ABI says output = { kind: 'record', path: ['LoyaltyCard'], program: 'loyalty_token' }
// 'loyalty_token' isn't this contract's program — Veil fetches its ABI automatically (or from imports override)
const output = outputs[0]  // RecordValue (parsed using loyalty_token's RecordDef)
```

#### Mixed output kinds within one transition

A single transition's outputs can mix record kinds, plaintext values, and finalize handles in any order. Veil parses each according to its `FunctionOutput.kind`:

```ts
// check_voucher returns: [RewardVoucher record, u8 reward_type, u64 amount]
const result = await contract.simulate.check_voucher({ inputs: [voucher] })
result.outputs[0]  // RecordValue (the voucher, unchanged)
result.outputs[1]  // PlaintextValue — number (U8)
result.outputs[2]  // PlaintextValue — bigint (U64)
```

#### Multi transition transactions

Cross program calls produce multiple transitions. Each appears as its own entry in `result.transitions`, with outputs scoped to that transition. `result.outputs` returns the top-level function's outputs (what the caller asked for); `result.transitions` provides the full call chain for tracing and debugging.

```ts
// redeem_points_for_voucher in loyalty_rewards calls loyalty_token/spend_points internally
const result = await contract.execute.redeem_points_for_voucher({
  inputs: [card, RewardType.Discount, 500n],
})

result.transitions  // [
                    //   {
                    //     transitionId: 'au1...',
                    //     program: 'loyalty_token.aleo',
                    //     function: 'spend_points',
                    //     outputs: [updatedCard],          // RecordValue
                    //   },
                    //   {
                    //     transitionId: 'au2...',
                    //     program: 'loyalty_rewards.aleo',
                    //     function: 'redeem_points_for_voucher',
                    //     outputs: [updatedCard, voucher, future],
                    //   },
                    // ]
```

#### Records sent to other owners

When a function produces a record owned by someone else (e.g., `transfer_card` mints a record for the recipient), the output is returned as `EncryptedRecord` rather than `RecordValue`. Only owned records are decryptable; records for other owners always come back encrypted.

```ts
// transfer_card outputs a LoyaltyCard owned by the recipient
const result = await contract.execute.transfer_card({ inputs: [card, recipient] })
result.outputs[0]   // EncryptedRecord (we don't own it, can't decrypt)
                    // { kind: 'encryptedRecord', ciphertext: 'record1...', commitment, program, recordName }
```

### TypeScript inference (future)

With `as const` or `defineAbi()`, function names and argument types can be fully inferred at compile time:

```ts
contract.execute.mint_card({
  inputs: [recipient, initialPoints, nonce]
  //       ^Address    ^U64           ^Field  (inferred from ABI)
})

const result = await contract.execute.mint_card({ inputs: [...] })
// result.outputs[0]: RecordValue<LoyaltyCardFields>  (inferred)
```

Requires TypeScript type-level programming over the ABI (similar to viem's abitype).

Two approaches for preserving literal types from ABI JSON (both planned):
1. **`defineAbi()` wrapper** — users call `defineAbi(abiJson)` to preserve literal types via `const` generic. Works at runtime without tooling.
2. **CLI code generation** — generate `.d.ts` files from `abi.json` at build time (wagmi-cli approach). Stronger guarantees, integrates with build pipelines.

### Type mapping: Aleo Primitive → TypeScript runtime

From `primitives.ts`:

| Aleo Primitive | TypeScript | Notes |
|---------------|-----------|-------|
| `address` | `string` | `aleo1...` |
| `boolean` | `boolean` | |
| `field`, `group`, `scalar`, `signature` | `string` | Algebraic types as strings |
| `u8`, `u16`, `u32` | `number` | Fits in JS number |
| `u64`, `u128` | `bigint` | Requires precision |
| `i8`, `i16`, `i32` | `number` | |
| `i64`, `i128` | `bigint` | |

---

## Records & Private State

### Record lifecycle

Records are Aleo's private state — encrypted UTXOs consumed on use. The contract API handles this transparently:

1. **Creation** — `execute` returns outputs per transition; each output is a `RecordValue` (if decryptable and we own it), an `EncryptedRecord` (if not ours or decryption skipped), or a plaintext value / future
2. **Consumption** — Pass a `RecordInput` as an input to consume the record
3. **Discovery** — `createRecordScanner()` to find records on-chain
4. **Decryption** — controlled by the wallet's decrypt permission level (set at connect-time). See [Decryption policy](#decryption-policy).

### Record input forms

Record-typed inputs accept any of the following (the union type lives in `types/primitives.ts`):

```ts
// Defined in the types layer (see Foundation section)
type RecordInput =
  | RecordValue        // dApp has the full plaintext (current default)
  | RecordRef          // a handle the wallet resolves; dApp never sees plaintext
  | string             // raw plaintext escape hatch (pre-encoded)
```

`RecordValue` works today; the dApp holds the full record contents and Veil serializes them for proving.

`RecordRef` (deferred — concrete shape TBD with the types layer) is for cases where the dApp wants to delegate record selection to the wallet without seeing the contents. The dApp says "use a record matching X" and the wallet picks one. This preserves privacy: the wallet sees the plaintext, the dApp does not.

Likely shapes for `RecordRef` (to be finalized in the types PR):
```ts
type RecordRef =
  | { kind: 'commitment'; commitment: string; program: string; recordName: string }
  | { kind: 'selector'; program: string; recordName: string; criteria?: { ... } }
```

The contract API doesn't care which variant you pass — it forwards `RecordRef` to the wallet's RPC interface (or the proving config for local accounts) and the resolver picks the actual record. The implementation lands when an SDK backend supports the resolver protocol.

```ts
// RecordValue — dApp holds the plaintext
const card = result.outputs[0] as RecordValue
await contract.execute.add_points({ inputs: [card, 500n] })

// RecordRef — wallet selects, dApp never sees the record
await contract.execute.add_points({
  inputs: [{ kind: 'commitment', commitment: '...', program: 'loyalty_token', recordName: 'LoyaltyCard' }, 500n],
})

// Records sent to other owners come back as EncryptedRecord (output direction)
await contract.execute.transfer_card({ inputs: [card, recipientAddress] })
```

**Proving requires the raw plaintext** — Veil calls `record.toString()` to serialize `RecordValue` inputs. For `RecordRef` inputs, the wallet handles the resolution and serialization internally.

### Non-decryptable outputs

Records that aren't ours (or that we opted not to decrypt) come back as `EncryptedRecord`:

```ts
type EncryptedRecord = {
  kind: 'encryptedRecord'
  ciphertext: string        // the on-chain record1... string
  commitment: string        // unique commitment for indexing
  program: string           // program that owns the record type
  recordName: string        // e.g. 'LoyaltyCard'
}
```

This preserves the full on-chain data so callers can:
- Log/store the ciphertext
- Hand it off to another account that owns it
- Retry decryption later (e.g., if the wallet grants permission)

### Record scanning

```ts
import { createRecordScanner } from '@veil/provable'

const scanner = createRecordScanner({
  url: 'https://api.provable.com/scanner',
  account,
  apiKey: '...',
  consumerId: '...',
})

const cards = await scanner.findRecords({
  program: 'loyalty_token.aleo',
  record: 'LoyaltyCard',
  startHeight: 0,
  unspent: true,
})
// Returns RecordValue[] parsed with the program's RecordDef
```

**Aleo vs EVM:** EVM has `balanceOf()` — a simple view call. Aleo's private state requires scanning + decryption + serial number checks. Inherently async. The scanner abstraction hides this.

---

## Cross-Program Calls

Veil auto-resolves imported programs by default. The ABI's `FunctionInput`/`FunctionOutput` references track which programs each function touches (e.g., `{ kind: 'record', path: ['LoyaltyCard'], program: 'loyalty_token' }`). Veil fetches each imported program's ABI (via explorer API) and source (via `getCode()`) automatically.

```ts
// Auto-resolved — no manual imports needed for deployed programs
const rewardsContract = getContract({
  program: 'loyalty_rewards.aleo',
  abi: parseAbi(rewardsAbi),
  programSource: rewardsSource,
  publicClient,
  walletClient,
})

// Cross-program call — Veil fetched loyalty_token's ABI and source automatically
await rewardsContract.execute.redeem_points_for_voucher({
  inputs: [card, rewardType, cost],
})

// When parsing outputs, Veil resolves each transition's records against the correct ABI:
// transition 0 (loyalty_token.aleo/spend_points) → parsed using loyalty_token's RecordDefs (auto-fetched)
// transition 1 (loyalty_rewards.aleo/redeem_points_for_voucher) → parsed using rewardsAbi's RecordDefs
```

Manual `imports` overrides auto-resolution for specific programs (useful for local development, undeployed programs, or pinning a specific edition):

```ts
const rewardsContract = getContract({
  program: 'loyalty_rewards.aleo',
  abi: parseAbi(rewardsAbi),
  programSource: rewardsSource,
  imports: {
    'loyalty_token.aleo': { abi: parseAbi(tokenAbi), programSource: tokenSource },
  },
  publicClient,
  walletClient,
})
```

---

## Proving Configuration

```ts
// Local — prove on this machine (WASM, slower but private)
const { walletClient } = createAleoClient({
  privateKey: '...',
  networkUrl: '...',
  provingMode: 'local',
})

// Delegated — offload to DPS
const { walletClient } = createAleoClient({
  privateKey: '...',
  networkUrl: '...',
  provingMode: 'delegated',
  proverUrl: 'https://api.provable.com/prove/testnet',
  apiKey: '...',
  consumerId: '...',
})

// Wallet (RPC) — wallet handles everything
const walletClient = createWalletClient({
  account: rpcAccount(walletAdapter),
  transport: custom(window.aleo),
})
```

### Method × backend matrix

The two left columns apply to local accounts or SDK providers (where veil controls proving). The right column applies to wallet (RPC) accounts.

| Method | Local proving | Delegated proving | Wallet (RPC) |
|--------|--------------|-------------------|--------------|
| `execute` | `ProgramManager.execute()` | `ProgramManager.buildProvingRequest()` → DPS → wait → decrypt | Wallet handles end-to-end |
| `simulate` | `ProgramManager.run()` (no broadcast) | `ProgramManager.run()` (no broadcast) | Not available (throws `SimulateNotSupportedError`) |
| `write` | `ProgramManager.execute()` (no wait) | `ProgramManager.buildProvingRequest()` → DPS (no wait) | Wallet executes (no wait) |
| `read` | HTTP to node | HTTP to node | HTTP to node |

`simulate` always runs locally regardless of proving mode — it never broadcasts.

---

## Fee Handling

```ts
await contract.execute.mint_card({
  inputs: [...],
  fee: 10000n,         // microcredits
  privateFee: false,   // false = public (from mapping), true = private (from record)
})
```

**Aleo vs EVM:** EVM has `gas` × `gasPrice` + auto-estimation. Aleo has a flat priority fee, with public vs private payment. Finalize blocks consume the fee even if they fail — unique failure mode.

---

## Finalize Awareness

`AbiFunction.isFinal = true` indicates a function has a finalize block. This is a two-phase commit:
1. Proof accepted → transaction included
2. Finalize executes → public state (mappings) updated, or reverts

A finalize failure still consumes the fee. The contract API should surface this:

```ts
// Proposed: execute return reflects finalize status
const result = await contract.execute.mint_card({ inputs: [...] })
result.status         // 'confirmed' | 'finalize-failed' | 'rejected'
result.finalizeError  // present if status === 'finalize-failed'
```

---

## Error Handling

The contract API surfaces several distinct error categories. Reviewers should agree on which should be typed error classes vs generic `Error`.

### Pre-broadcast errors (all modes)

| Category | Example | When thrown | Proposed type |
|----------|---------|-------------|---------------|
| ABI validation | `Function "mint_cards" does not exist. Available: mint_card, ...` | `contract.execute.foo()` when `foo` isn't in ABI | `ProgramFunctionNotFoundError` |
| Input encoding | `Cannot encode "hello" as u64` | Runtime input validation fails | `InvalidInputError` (exists in core) |
| Unsupported operation | `simulate is not supported for rpc accounts` | Method not available for this account type | `SimulateNotSupportedError` |

### Local proving errors

These occur when `provingMode === 'local'` and veil is building the proof on-device:

| Category | Example | When thrown | Proposed type |
|----------|---------|-------------|---------------|
| Proving failure | `Failed to build proof for mint_card: constraint violation` | Key synthesis or proof generation fails | `ProvingError` |
| Authorization failure | `Failed to authorize: insufficient balance` | Fee authorization fails | `ProvingError` |

### Delegated proving / broadcast errors

When `provingMode === 'delegated'`, proving happens on the DPS. Broadcast errors from snarkos come back through the DPS response. When broadcasting directly (local proving), these come from the node.

| Category | Example | HTTP | Proposed type |
|----------|---------|------|---------------|
| Invalid transaction | `Transaction '{t}' is not well-formed: {error}` | 400/422 | `InvalidTransactionError` |
| Transaction too large | `Transaction size exceeds the byte limit` | 400 | `InvalidTransactionError` |
| Incorrect ID | `Incorrect transaction ID ({t})` | 422 | `InvalidTransactionError` |
| Duplicate transaction | `Transaction '{t}' already exists in the ledger` | 422 | `DuplicateTransactionError` |
| Record already used | `Found a duplicate (Output ID\|Input ID\|commitment\|nonce\|serial_number)` | 422 | `RecordAlreadyUsedError` |
| Verification queue full | `Too many execution/deploy verifications in progress` | 422 | `BroadcastError` |
| Rate limited | `Too many requests` | 429 | `BroadcastError` |
| Node syncing | `Unable to validate transaction (node is syncing)` | 503 | `BroadcastError` |

### Post-broadcast errors (all modes that broadcast)

| Category | Example | When thrown | Proposed type |
|----------|---------|-------------|---------------|
| Confirmation timeout | `Transaction <id> not confirmed within 300s` | Delegated mode wait timeout | `TransactionTimeoutError` |
| Finalize failure | `Finalize reverted: ...` | Finalize block fails on-chain | `FinalizeRevertError` |
| Decryption | `Cannot decrypt record: account is not the owner` | Output record isn't ours | `RecordDecryptionError` |

These errors apply to `contract.execute`, `contract.write`, and the standalone `walletClient.executeTransaction` / `walletClient.writeContract` methods.

```ts
try {
  const result = await contract.execute.mint_card({ inputs: [...] })
} catch (e) {
  if (e instanceof FinalizeRevertError) {
    // Finalize ran but reverted — fee was still consumed
  } else if (e instanceof TransactionTimeoutError) {
    // Tx may still confirm later; get the tx ID from e.transactionId
  } else if (e instanceof RecordAlreadyUsedError) {
    // Record was already spent — refresh records and retry
  } else if (e instanceof DuplicateTransactionError) {
    // Transaction already submitted — safe to treat as success
  }
}
```

**Key distinction from EVM:** In EVM, a transaction either succeeds or reverts as one event. In Aleo, the proof can succeed, the transaction can be included, and the finalize can still fail — consuming the fee without updating public state. The error type must reflect this.

**Broadcast error codes** (from the snarkos broadcast endpoint):

| HTTP Status | Meaning | Error type |
|-------------|---------|------------|
| 400 | Invalid transaction data | `InvalidTransactionError` |
| 422 | Well-formed but invalid (duplicate, spent record, bad ID) | `InvalidTransactionError`, `DuplicateTransactionError`, or `RecordAlreadyUsedError` (matched by message) |
| 429 | Rate limited / congestion | `BroadcastError` |
| 503 | Node overloaded | `BroadcastError` |

---

## Client Architecture

```
┌─────────────────────────────────────────────────────┐
│  getContract({ program, abi, publicClient, walletClient })          │
│  ├─ contract.read.*     → publicClient.readContract  │
│  ├─ contract.execute.*  → walletClient.executeTransaction│
│  ├─ contract.simulate.* → walletClient.simulateContract│
│  └─ contract.write.*    → walletClient.writeContract  │
├─────────────────────────────────────────────────────┤
│  createPublicClient({ transport })                   │
│  createWalletClient({ account, transport, proving }) │
├─────────────────────────────────────────────────────┤
│  Transports:  http() | custom() | fallback()         │
│  Accounts:    privateKeyToAccount() | rpcAccount()   │
│  Proving:     createProvingConfig({ mode, ... })     │
│  Records:     createRecordScanner({ url, ... })      │
│  ABI:         parseAbi() | parsePlaintext()          │
│  Types:       Primitive | Plaintext | RecordValue    │
└─────────────────────────────────────────────────────┘
```

## Standalone Actions

`getContract` is a convenience. Every method it provides also exists as a standalone action that takes the client directly — matching viem's pattern of having both `contract.read.foo()` and `publicClient.readContract(...)`.

```ts
// Via contract instance
const balance = await contract.read.account({ key: address })

// Standalone
const balance = await publicClient.readContract({
  program: 'credits.aleo',
  mapping: 'account',
  key: address,
})

// Same for execute / simulate / write
const { outputs } = await walletClient.executeTransaction({
  program: 'loyalty_token.aleo',
  function: 'mint_card',
  inputs: ['aleo1...', '1000u64', '42field'],   // pre-encoded without ABI
  fee: 10000n,
  programSource: tokenSource,
})
```

Use standalone actions when you don't have (or don't want) an ABI. Method names aren't validated, inputs aren't auto-encoded, outputs aren't auto-parsed — you get raw `string[]` for outputs and must pre-encode inputs.

## Using `getContract` without an ABI

The ABI is optional. Without it, Veil falls back to dynamic proxies — any method name is accepted, no encoding, raw string I/O:

```ts
const contract = getContract({
  program: 'loyalty_token.aleo',
  programSource: tokenSource,
  publicClient,
  walletClient,
  // no abi
})

// Works — no validation, no encoding
await contract.execute.mint_card({
  inputs: ['aleo1...', '1000u64', '42field'],   // pre-encoded
  fee: 10000n,
})
// outputs are raw Aleo strings
```

Useful for quick prototyping, on-chain discovery (via `fetchAbi`), or when only raw strings are available.

---

## React & Node Consumption

### React consumption (wagmi-style)

```ts
// Read a mapping — TanStack Query powered (cached, dedup, refetch)
const { data: balance, isPending, error } = useReadContract({
  program: 'credits.aleo',
  mapping: 'account',
  key: address,
})

// Execute a function — imperative mutation (matches wagmi's useWriteContract)
const {
  executeTransaction,         // fire-and-forget
  executeTransactionAsync,    // returns Promise<ExecuteResult>
  data,                    // ExecuteResult | undefined
  isPending,
  error,
} = useExecuteContract()

// In a handler:
function onMint() {
  executeTransaction({
    program: 'loyalty_token.aleo',
    abi: parseAbi(tokenAbi),
    functionName: 'mint_card',
    inputs: [address, 1000n, 42n],
  })
}

// Simulate (auto-query, pair with execute)
const { data: simData } = useSimulateContract({
  program: 'loyalty_token.aleo',
  abi: parseAbi(tokenAbi),
  functionName: 'mint_card',
  inputs: [address, 1000n, 42n],
})
// simData.outputs is what execute would return (without broadcasting)

// Record discovery — TanStack Query
const { data: records } = useRecords({
  program: 'loyalty_token.aleo',
  record: 'LoyaltyCard',
})
```

**Wagmi layering, applied to Veil:**
- `useReadContract` → TanStack Query (cached, dedup, stale-while-revalidate)
- `useExecuteContract` → TanStack Mutation (imperative, loading/error/success state)
- `useSimulateContract` → TanStack Query (auto-runs, data pipes to execute)
- `useRecords`, `useWaitForTransaction` → TanStack Query
- Plus: `useAccount`, `useConnect`, `useDisconnect` for wallet connection

### Node.js consumption

```ts
import { getContract, parseAbi } from '@veil/core'
import { createAleoClient } from '@veil/provable'

const { publicClient, walletClient } = createAleoClient({ ... })

const contract = getContract({
  program: 'loyalty_token.aleo',
  abi: parseAbi(tokenAbi),
  programSource: tokenSource,
  publicClient,
  walletClient,
})

const { outputs } = await contract.execute.mint_card({
  inputs: [address, 1000n, 42n],
})
```

Same core API, no hooks.

---

## Out of Scope

- **Program compilation** — Leo → Aleo IR is a build step
- **Program deployment** — Separate flow (`deployContract` exists but not part of `getContract`)
- **Key management** — Wallet's concern
- **UI components** — Application layer

---

## Comparison: Veil vs Viem

| Capability | viem | Veil | Notes |
|-----------|------|------|-------|
| Contract instance | `getContract()` | `getContract()` | Same pattern |
| Read state | `readContract()` | `readContract()` | viem: view funcs. Veil: mappings |
| Write state | `writeContract()` → hash | `writeContract()` → txId | Same |
| Simulate | `simulateContract()` → `{ result, request }` | `simulateContract()` → outputs | Slightly different return |
| Full execute | `writeContract` + `waitForReceipt` | `executeTransaction()` | Veil combines into one (decryption needed) |
| ABI types | `abitype` (Solidity) | `Primitive`, `Plaintext`, `ABI` (Aleo) | Same concept |
| Events | `watchContractEvent`, `getContractEvents` | Aleo has no native event system; indexing-based approximations are future work | |
| Multicall | on-chain Multicall3 | parallel HTTP | |
| Gas estimation | `estimateContractGas()` | `estimateFee()` (proposed) | |
| Records | N/A | `createRecordScanner()` | Unique to Aleo |
| Proving | N/A | `createProvingConfig()` | Unique to Aleo |
| React | wagmi | `@veil/react` | Same layering |

---

## Open Design Questions

1. **Finalize status in `execute` return** — Surface `'confirmed' | 'finalize-failed' | 'rejected'` instead of throwing for finalize failures?
2. **Auto-fee estimation** — Default behavior or opt-in? Adds an API call.
3. **Progress callbacks** — `onProving`, `onBroadcast`, `onConfirmed` for long-running delegated flows?
4. **Record caching** — Should contract instances cache returned records for subsequent calls, or is that the application's job?
5. **Import auto-resolution** — ABI tells us what programs are referenced; should Veil fetch import sources automatically from the chain?
6. **Multi-program "protocol" abstraction** — Higher-level concept for programs that work together (loyalty_token + loyalty_rewards)?
7. **Offline guarantee** — Should `simulate` explicitly guarantee no network access? Useful for testing.
8. **Error classes** — Typed error classes (`FinalizeRevertError`, `ProvingError`, etc.) vs generic `Error` with `code`?
9. **`dynamicRecord` inputs** — `FunctionInput.kind === 'dynamicRecord'` is in the ABI but not widely used. When is this needed and how should Veil present it?
10. **`RecordRef` shape** — Concrete shape and resolver protocol for the wallet-selected record case. Coordinate with the types layer (`RecordInput` union).

