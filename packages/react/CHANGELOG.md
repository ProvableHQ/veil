# @provablehq/veil-aleo-react-hooks

## 0.12.1

### Patch Changes

- @provablehq/veil-core@0.12.1
- @provablehq/veil-aleo-wallet-adapter@0.12.1

## 0.12.0

### Minor Changes

- Move to the snarkVM 4.11.0 toolchain: `@provablehq/sdk` 0.12.0, `@provablehq/aleo-devnode` 0.3.0, and Leo 4.4.5. The default devnode consensus-heights list now has twenty-two entries and activates every live consensus version at genesis, so a devnode runs V21 (Varuna V3) from its first block; the SDK builds every deployment and execution against the latest Varuna version, and a node still on an earlier version rejects them. `ConsensusVersion::V22` stays a placeholder pinned to `u32::MAX`. A caller who passes an explicit `CONSENSUS_VERSION_HEIGHTS` MUST pass twenty-two heights or the WASM transaction builder panics, and MUST activate V21 by the first block that carries a transaction.

  Peer ranges on `@provablehq/veil-core` and `@provablehq/veil-aleo-devnode` now start at 0.12.0.

  The wallet adapter dependencies move from the deprecated `@provablehq/aleo-wallet-adaptor-*` packages to their renamed successors `@provablehq/aleo-wallet-adapter-*` (core 1.1.1, react 1.3.0, shield 1.2.1, leo/puzzle/fox 1.1.1). Exported symbol names are unchanged; a consumer MUST replace every `aleo-wallet-adaptor-` import and dependency with `aleo-wallet-adapter-` in the same change, because a provider from one package name cannot supply context to hooks from the other. The optional peer on `@provablehq/veil-aleo-wallet-adapter` is now `@provablehq/aleo-wallet-adapter-core`. The renamed react adapter accepts React 19 as a peer.

### Patch Changes

- Updated dependencies
  - @provablehq/veil-core@0.12.0
  - @provablehq/veil-aleo-wallet-adapter@0.12.0

## 0.11.1

### Patch Changes

- @provablehq/veil-core@0.11.1
- @provablehq/veil-aleo-wallet-adapter@0.11.1

## 0.11.0

### Patch Changes

- @provablehq/veil-core@0.11.0
- @provablehq/veil-aleo-wallet-adapter@0.11.0

## 0.10.1

### Patch Changes

- caf4425: Default every hosted endpoint to the `edge.provable.com/api` gateway: the delegated prover, the record scanner, the React hook's node URL, and the shield-swap CLI's network URL. The gateway is unauthenticated and needs no consumer or JWT, so a client built from a private key and a network URL proves and scans out of the box; a provisioned key still goes through `auth`. The legacy JWT model stays supported for a caller who points the client at a legacy gateway: with `proverUrl` or the scanner `url` on `https://api.provable.com/...` and a `consumerId` + `apiKey` pair (or a `credentialStore`), a session mints at that gateway's `/jwts` and injects the token. On the default gateway the pair is carried and nothing mints. Consumer registration is retired: `registerProvableApi` is a no-op that resolves `undefined`, `username` is ignored, and a client without a pair never registers one. `authenticateProvableApi` no longer throws on a keyed or credential-less client; it resolves with `registered: false` and, without a pair, no `credentials` and no `expiration`. Bumps `@provablehq/sdk` to 0.11.10, which makes the same default change in the underlying SDK.
- Updated dependencies [caf4425]
  - @provablehq/veil-core@0.10.1
  - @provablehq/veil-aleo-wallet-adapter@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [ca51d13]
  - @provablehq/veil-core@0.10.0
  - @provablehq/veil-aleo-wallet-adapter@0.10.0

## 0.9.0

### Patch Changes

- @provablehq/veil-core@0.9.0
- @provablehq/veil-aleo-wallet-adapter@0.9.0

## 0.8.0

### Patch Changes

- @provablehq/veil-core@0.8.0
- @provablehq/veil-aleo-wallet-adapter@0.8.0

## 0.7.1

### Patch Changes

- Updated dependencies [99defd6]
  - @provablehq/veil-core@0.7.1
  - @provablehq/veil-aleo-wallet-adapter@0.7.1

## 0.7.0

### Patch Changes

- Updated dependencies [e93d7a3]
- Updated dependencies [4be5291]
  - @provablehq/veil-core@0.7.0
  - @provablehq/veil-aleo-wallet-adapter@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [387a580]
- Updated dependencies [bc51d70]
- Updated dependencies [bc51d70]
- Updated dependencies [bc51d70]
  - @provablehq/veil-core@0.6.0
  - @provablehq/veil-aleo-wallet-adapter@0.6.0

## 0.5.0

### Minor Changes

- Version alignment with the 0.5.0 release of the fixed Veil package group
  (agent skills + DEX API auth in `@provablehq/shield-swap-sdk`, FeeMaster
  fee payment in `@provablehq/veil-aleo-sdk`).

## 0.4.1

### Patch Changes

- @provablehq/veil-core@0.4.1
- @provablehq/veil-aleo-wallet-adapter@0.4.1
