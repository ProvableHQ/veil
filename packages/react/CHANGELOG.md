# @provablehq/veil-aleo-react-hooks

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
