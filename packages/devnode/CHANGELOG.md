# @provablehq/veil-aleo-devnode

## 0.12.0

### Minor Changes

- Move to the snarkVM 4.11.0 toolchain: `@provablehq/sdk` 0.12.0, `@provablehq/aleo-devnode` 0.3.0, and Leo 4.4.5. The default devnode consensus-heights list now has twenty-two entries and activates every live consensus version at genesis, so a devnode runs V21 (Varuna V3) from its first block; the SDK builds every deployment and execution against the latest Varuna version, and a node still on an earlier version rejects them. `ConsensusVersion::V22` stays a placeholder pinned to `u32::MAX`. A caller who passes an explicit `CONSENSUS_VERSION_HEIGHTS` MUST pass twenty-two heights or the WASM transaction builder panics, and MUST activate V21 by the first block that carries a transaction.

  Peer ranges on `@provablehq/veil-core` and `@provablehq/veil-aleo-devnode` now start at 0.12.0.

## 0.11.1

### Patch Changes

- 3d329de: Align the default consensus schedule with aleo-devnode 0.2.6 and Provable SDK 0.11.11, activating all 21 supported versions.

## 0.11.0

## 0.10.1

## 0.10.0

## 0.9.0

## 0.8.0

## 0.7.1

## 0.7.0

### Minor Changes

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

## 0.6.0

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
