# @provablehq/veil-aleo-sdk

## 0.6.0

### Patch Changes

- Updated dependencies [387a580]
- Updated dependencies [bc51d70]
- Updated dependencies [bc51d70]
- Updated dependencies [bc51d70]
  - @provablehq/veil-core@0.6.0
  - @provablehq/veil-aleo-devnode@0.6.0

## 0.5.0

### Minor Changes

- `useFeeMaster` threads through `createProvingConfig` and
  `createAleoClient`, and defaults to true: the delegated prover pays
  transaction fees, so accounts holding no public credits can transact out
  of the box. Pass `useFeeMaster: false` when the account funds its own
  fees.
- Internal peer ranges widened from `workspace:*` to `workspace:^`.

## 0.4.1

### Patch Changes

- @provablehq/veil-core@0.4.1
- @provablehq/veil-aleo-devnode@0.4.1
