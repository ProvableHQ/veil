# @provablehq/shield-swap-cli

## 0.7.1

### Patch Changes

- Updated dependencies
- Updated dependencies [99defd6]
  - @provablehq/veil-aleo-sdk@0.7.1
  - @provablehq/shield-swap-sdk@0.7.1

## 0.7.0

### Minor Changes

- cda4f20: Move the trader scripts out of `@provablehq/shield-swap-sdk` and into a new
  `@provablehq/shield-swap-cli` package, which installs a `shield-swap` binary.

  The scripts previously shipped as raw TypeScript under `skills/scripts/` and ran
  with `npx tsx` from inside `node_modules`. They are now subcommands —
  `shield-swap setup`, `pools`, `balances`, `positions`, `swap`, `swap-concurrent`,
  `history`, `mint`, `liquidity`, `collect`, `liquidity-e2e` — compiled and
  typechecked like the rest of the workspace. `swap-history` is now `history`; every
  other name is unchanged, as are all flags and the `--execute` and `--json`
  contracts.

  The CLI is a separate install so a project that only needs the client does not
  pull it in: `@provablehq/shield-swap-sdk` no longer ships `skills/scripts/`, and
  its tarball carries only `dist` and the runbook markdown.

  Migrating: install `@provablehq/shield-swap-cli` and replace
  `npx tsx node_modules/@provablehq/shield-swap-sdk/skills/scripts/<name>.ts` with
  `shield-swap <name>` (`npx shield-swap <name>` for a project-local install), and
  import the session helpers from `@provablehq/shield-swap-cli/session` rather than by
  path. Invoke the binary rather than the package: `npx @provablehq/shield-swap-cli`
  resolves against the registry, so the version can change between two commands and
  it needs a network.

### Patch Changes

- Updated dependencies [c2124ee]
- Updated dependencies [cda4f20]
- Updated dependencies [e93d7a3]
- Updated dependencies [e93d7a3]
- Updated dependencies [e93d7a3]
- Updated dependencies [e93d7a3]
- Updated dependencies [e93d7a3]
- Updated dependencies [e93d7a3]
- Updated dependencies [e93d7a3]
- Updated dependencies [cda4f20]
- Updated dependencies [4be5291]
- Updated dependencies [cda4f20]
- Updated dependencies [cda4f20]
- Updated dependencies [cda4f20]
- Updated dependencies [4be5291]
- Updated dependencies [cda4f20]
- Updated dependencies [cda4f20]
- Updated dependencies [c2124ee]
- Updated dependencies [e93d7a3]
- Updated dependencies [e93d7a3]
  - @provablehq/shield-swap-sdk@0.7.0
  - @provablehq/veil-aleo-sdk@0.7.0
