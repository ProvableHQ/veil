# @provablehq/veil-codegen

## 0.12.0

### Minor Changes

- Move to the snarkVM 4.11.0 toolchain: `@provablehq/sdk` 0.12.0, `@provablehq/aleo-devnode` 0.3.0, and Leo 4.4.5. The default devnode consensus-heights list now has twenty-two entries and activates every live consensus version at genesis, so a devnode runs V21 (Varuna V3) from its first block; the SDK builds every deployment and execution against the latest Varuna version, and a node still on an earlier version rejects them. `ConsensusVersion::V22` stays a placeholder pinned to `u32::MAX`. A caller who passes an explicit `CONSENSUS_VERSION_HEIGHTS` MUST pass twenty-two heights or the WASM transaction builder panics, and MUST activate V21 by the first block that carries a transaction.

  Peer ranges on `@provablehq/veil-core` and `@provablehq/veil-aleo-devnode` now start at 0.12.0.

### Patch Changes

- Updated dependencies
  - @provablehq/veil-core@0.12.0

## 0.11.1

### Patch Changes

- @provablehq/veil-core@0.11.1

## 0.11.0

### Patch Changes

- @provablehq/veil-core@0.11.0

## 0.10.1

### Patch Changes

- Updated dependencies [caf4425]
  - @provablehq/veil-core@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [ca51d13]
  - @provablehq/veil-core@0.10.0

## 0.9.0

### Patch Changes

- @provablehq/veil-core@0.9.0

## 0.8.0

### Patch Changes

- @provablehq/veil-core@0.8.0

## 0.7.1

### Patch Changes

- Updated dependencies [99defd6]
  - @provablehq/veil-core@0.7.1

## 0.7.0

### Patch Changes

- Updated dependencies [e93d7a3]
- Updated dependencies [4be5291]
  - @provablehq/veil-core@0.7.0

## 0.6.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [387a580]
- Updated dependencies [bc51d70]
- Updated dependencies [bc51d70]
- Updated dependencies [bc51d70]
  - @provablehq/veil-core@0.6.0

## 0.5.0

### Minor Changes

- Version alignment with the 0.5.0 release of the fixed Veil package group
  (agent skills + DEX API auth in `@provablehq/shield-swap-sdk`, FeeMaster
  fee payment in `@provablehq/veil-aleo-sdk`).

## 0.4.1

### Patch Changes

- @provablehq/veil-core@0.4.1
