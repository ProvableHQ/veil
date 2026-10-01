# @provablehq/veil-leo

## 0.12.0

### Minor Changes

- Move to the snarkVM 4.11.0 toolchain: `@provablehq/sdk` 0.12.0, `@provablehq/aleo-devnode` 0.3.0, and Leo 4.4.5. The default devnode consensus-heights list now has twenty-two entries and activates every live consensus version at genesis, so a devnode runs V21 (Varuna V3) from its first block; the SDK builds every deployment and execution against the latest Varuna version, and a node still on an earlier version rejects them. `ConsensusVersion::V22` stays a placeholder pinned to `u32::MAX`. A caller who passes an explicit `CONSENSUS_VERSION_HEIGHTS` MUST pass twenty-two heights or the WASM transaction builder panics, and MUST activate V21 by the first block that carries a transaction.

  Peer ranges on `@provablehq/veil-core` and `@provablehq/veil-aleo-devnode` now start at 0.12.0.

## 0.11.1

## 0.11.0

## 0.10.1

## 0.10.0

## 0.9.0

## 0.8.0

## 0.7.1

## 0.7.0

## 0.6.0

## 0.5.0

### Minor Changes

- Version alignment with the 0.5.0 release of the fixed Veil package group
  (agent skills + DEX API auth in `@provablehq/shield-swap-sdk`, FeeMaster
  fee payment in `@provablehq/veil-aleo-sdk`).

## 0.4.1
