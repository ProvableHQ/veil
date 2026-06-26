# Design: Wallet Adapter Privacy-Preserving Dapps Integration

**Date:** 2026-06-26
**Branch:** `feat/wallet-adapter-update`
**Status:** Approved design, pending implementation plan

## Purpose

Integrate the upstream ProvableHQ "privacy-preserving dapps" feature (shipped in
`@provablehq/*` `1.0.0`) into Veil, so a Veil dapp can transact while learning as
little as possible about the user: grant fine-grained record/field access at
connect time, withhold the address, and let the wallet fulfil transaction inputs
(address injection, record selection, derived/blinding values) without the dapp
seeing plaintext.

Upstream reference:
https://github.com/ProvableHQ/aleo-dev-toolkit/blob/master/docs/privacy-preserving-dapps.md

## Scope

In scope (this branch): the generic privacy plumbing end-to-end — connect-time
grants, and `InputRequest`-based transaction inputs (`address`, `record`,
`derived`) flowing through Veil's transaction API and read results.

Out of scope (separate DEX branch): Veil-native ergonomic *builders* for the
`program-scoped-blinding-factor` / `program-scoped-blinded-address` derived
algorithms. The generic `type:'derived'` passthrough IS in scope; only the
DEX-specific convenience helpers are deferred. DEX is a separate concern and gets
its own branch.

## Upstream delta (0.3.0-alpha.3 → 1.0.0)

All three families bumped to `1.0.0` (published `latest`). Changes that reach
Veil:

- `TransactionOptions.inputs: string[]` → `TransactionInput[]`
  (`TransactionInput = string | InputRequest`). Source-compatible widening.
- `requestRecords(program, includePlaintext, statusFilter?)` — adds
  `statusFilter` (Veil's wrapper already declared it); returns
  `RecordEnvelope[]` (`uid` / `recordView` / `recordName` / `programName` /
  `spent`).
- New adapter method `algorithmsSupported(): Promise<string[]>`.
- `connect(..., options?: ConnectOptions)` — connect-time grants
  (`recordAccess`, `readAddress`, `algorithmsAllowed`).
- Address-withholding: `decrypt` / `requestRecords` / `transitionViewKeys` /
  `requestTransactionHistory` throw `WalletAddressWithheldError` at runtime when
  connected with `readAddress: false` (signatures unchanged).
- New error classes: `WalletInputRequestNotSupportedError`,
  `WalletConnectOptionsNotSupportedError`, `WalletInputRequestInvalidError`,
  `WalletAddressWithheldError`.
- Nothing removed/renamed in the symbols Veil uses. `DecryptPermission` /
  `OnChainHistory` are unchanged (not new).

`@provablehq/sdk` (in `@veil/provable`) is a different package and is NOT bumped.

## Decision: type ownership

`@veil/core` defines **local mirror types** for the new shapes, framed as
Provable wallet-standard types (consistent with the existing core convention of
not importing `@provablehq/*` into its public surface). Mirrors are field-for-
field identical to upstream so the shim boundary is a structural identity, not a
translation. Only the shims (`@veil/wallet-adapter`, `@veil/react`) touch
`@provablehq/*`. This preserves the "Veil is an interface" constraint —
`@provablehq/*` stays out of `@veil/core` and `@veil/react` public APIs.

## Architecture: four layers

### Layer 1 — `@veil/core` types (mirror)

New `packages/core/src/types/inputRequest.ts`:

- `InputRequest`:
  - `{ type: 'address'; label?: string }`
  - `{ type: 'record'; program: string; recordname: string; filters?: RecordFilters; uid?: string }`
    (`filters` and `uid` mutually exclusive)
  - `{ type: 'derived'; algorithm: AlgorithmName; args: Record<string, AlgorithmArg>; label?: string }`
- `TransactionInput = string | InputRequest`
- `RecordFilters = Record<string, { eq?; gte?; lte?; neq? }>`
- `AlgorithmArg = { type: ArgType; value: string }`, `AlgorithmName` (known +
  open string), known algorithms constant.
- `RecordView = { fields: Record<string, string> }` (NEW type) — granted field
  key → Aleo-encoded value string. Keys may be a record-body field name, a
  dotted struct path (`"data.amount"`), or a `$`-prefixed envelope-metadata
  token (`"$commitment"`, `"$tag"`, …). Values stay strings for now (see Future
  enhancements).
- **Reuse, don't duplicate, the record type.** `@veil/core` already has
  `OwnedRecordEncrypted` and `OwnedRecord` (`extends OwnedRecordEncrypted` with
  `recordPlaintext: string`) in `types/records.ts`, with `programName`,
  `recordName`, `owner`, `spent`, `commitment`, `tag`, etc. The only genuinely
  new fields from the 1.0.0 privacy feature are `uid` and `recordView`, so we
  **extend the existing type** rather than introduce a parallel `RecordEnvelope`:
  ```ts
  interface OwnedRecordEncrypted {
    // …existing fields…
    uid?: string            // opaque per-connection handle; pass back as a record InputRequest `uid`
    recordView?: RecordView // granted plaintext fields when the wallet withholds full plaintext
  }
  ```
  `requestRecords` keeps returning `OwnedRecord[] | OwnedRecordEncrypted[]` (now
  carrying `uid`/`recordView`). `recordPlaintext` already exists on `OwnedRecord`
  for full-access/legacy consumers. No separate `RecordEnvelope` type is added.
  During implementation, verify the upstream `1.0.0` wire field names (`uid`,
  `recordView`) and match them so the mapping at the shim stays structural.
- Connect grants: `ConnectOptions`, `RecordAccessGrant`, `ProgramGrant`,
  `RecordGrant`, `FieldGrant`, `AlgorithmGrant`.
- Reuse existing `RecordStatusFilter`.

**Read type vs. input type (deliberately different).** An `OwnedRecord` is
never passed back into `inputs`. The only value that crosses from read → write
is the `uid` string: read returns `OwnedRecord[] | OwnedRecordEncrypted[]`, and
to spend one you place an inline `record` InputRequest carrying its `uid`
(`{ type: 'record', program, recordname, uid: rec.uid }`) — program and record
name come from the caller. No convenience helper is provided in this branch
(considered and dropped); consumers construct the request inline. Legacy record
inputs remain plain `string` plaintext literals (e.g. `rec.recordPlaintext`),
already covered by `TransactionInput`.

Each public type/field documented per the contributor doc-voice rules.

### Layer 2 — `@veil/core` input handling

- `actions/wallet/writeContract.ts`, `executeContract.ts`, `simulateContract.ts`:
  `inputs: string[]` → `inputs: TransactionInput[]`.
- `contract/getContract.ts`: `ContractWriteParams` / `ContractSimulateParams` /
  `ContractExecuteParams` `inputs: InputValue[]` → `(InputValue | InputRequest)[]`;
  `resolveInputs` passes an `InputRequest` through un-encoded (guard: object whose
  `type` is `'address' | 'record' | 'derived'`) and auto-encodes everything else.
  Mirror the same widening in `types/inference.ts`.
- `actions/wallet/requestRecords.ts`: result stays
  `OwnedRecord[] | OwnedRecordEncrypted[]` (now carrying `uid`/`recordView` via
  the extended type); no signature change needed.
- Transport request param plumbing passes `inputs` through unchanged to the
  transport (no stringification).
- **Local-proving guard:** any `InputRequest` reaching the local-proving path
  (`types/proving.ts`, string-only) throws a clear error — wallet-specified
  inputs require a wallet transport. Pure-string inputs unaffected.

### Layer 3 — `@veil/wallet-adapter` transport (`src/index.ts`)

- `executeTransaction` case: build `TransactionOptions` with
  `inputs: p?.inputs as TransactionInput[]` (drop `as string[]`); pass through to
  `adapter.executeTransaction` unchanged.
- `requestRecords` case: surfaces `uid`/`recordView` on the returned records
  (the extended `OwnedRecord(Encrypted)` shape); passes `statusFilter` through.
- Add `algorithmsSupported(): Promise<string[]>` to the `AleoWalletAdapter`
  interface mirror and an `algorithmsSupported` transport method →
  `adapter.algorithmsSupported()`.
- Document that `decrypt` / `requestRecords` / `transitionViewKeys` /
  `requestTransactionHistory` may throw `WalletAddressWithheldError` under
  `readAddress:false`. Re-export the new error types and request/grant types for
  consumers (mapping core mirror ↔ upstream at this boundary).

### Layer 4 — `@veil/react` connect grants (`src/provider.tsx`)

- `VeilProviderProps` gains `recordAccess?: RecordAccessGrant`,
  `readAddress?: boolean`, `algorithmsAllowed?: AlgorithmGrant[]` (core mirror
  types), forwarded to the underlying `AleoWalletProvider`.

### Layer 5 — Dependencies

Bump to `1.0.0`:
- `@veil/core`: `@provablehq/aleo-types` (devDep).
- `@veil/wallet-adapter`: `aleo-types`, `aleo-wallet-standard`,
  `aleo-wallet-adaptor-core` (dev + peer).
- `@veil/react`: `aleo-wallet-adaptor-{react,shield,leo,puzzle,fox}`,
  `aleo-wallet-standard`, `aleo-types`.

`pnpm install` to refresh the lockfile. `@provablehq/sdk` untouched.

## Examples, dApp, tests (contributor constraints)

- After the bump, the whole repo must build and `pnpm vitest run` must be green;
  `apps/loyalty-dapp` must typecheck. Existing string-input examples keep
  compiling (additive widening).
- Add a privacy-features demo to `examples/dapp-wallet-adapter.ts`: address
  injection (`{type:'address'}`), a record `uid` round-trip (`requestRecords` →
  envelope `uid` → `{type:'record', uid}`), and a `derived` input.
- New unit tests:
  - wallet-adapter: `InputRequest` passes through the transport to a mock adapter
    unchanged; `algorithmsSupported` wired; `requestRecords` surfaces
    `uid`/`recordView` on returned records.
  - core: `resolveInputs` passes `InputRequest` through and encodes plain values;
    local-proving path rejects `InputRequest`; action input types accept
    `TransactionInput[]`.
  - react: `VeilProvider` forwards grant props to `AleoWalletProvider`.

## Backwards compatibility

All changes are additive widenings (string inputs still valid; new optional
props/methods). No breaking changes → no hard-stop. But shared `@veil/core` types
change, so dependents (`wallet-adapter`, `react`, examples, dApp) are updated in
the same change and the green-build bar applies before completion.

## Future enhancements (not this branch)

- **Typed record-view values.** `RecordView.fields` values stay Aleo-encoded
  strings for now. Eventually add a decode helper that turns them into JS values
  (the read-side mirror of `resolveInputs`/ABI encoding on the input side), so
  `microcredits` comes back as `100` rather than `"100u64"`. Likely belongs with
  the same ABI layer; deferred to keep this integration focused.

## Non-goals

- DEX-specific blinded-address builder helpers (separate branch).
- Bumping `@provablehq/sdk`.
- Changing `connect`/`disconnect` flow in the wrapper (still consumer-driven;
  raw-adapter consumers pass `ConnectOptions` to `adapter.connect` directly).

## Open questions

None outstanding.
