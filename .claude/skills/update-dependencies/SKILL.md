---
name: update-dependencies
description: Check the four upstream Aleo dependency streams (@provablehq/sdk on npm, ProvableHQ/leo releases, ProvableHQ/aleo-devnode releases, and the @provablehq/aleo-wallet-adaptor-* packages from aleo-dev-toolkit) for new versions, apply the updates, re-run the affected integration tests, and fix whatever the bumps break. Use when asked to update, bump, or check Aleo/Provable dependencies or toolchain versions.
---

# Update Aleo dependency streams

Four upstream streams feed this repo. For each: detect a newer version, apply
it, re-run the affected tests, and fix breakage. Work one stream at a time and
commit each stream separately (`[Chore] Bump <thing> to <version>` plus any
`[Fix]` commits the bump forces). Devnode-gated tests require `leo` and
`aleo-devnode` on PATH.

Start with the detection script — it prints current-vs-latest for every stream
(including the CI workflow pins) and exits 1 when anything is stale:

```sh
./scripts/check-upstream-versions.sh
```

When it exits 0, every stream is current — report that and stop. Otherwise
work only the streams it flagged, using the sections below.

Full devnode verification command used throughout (append newer devnode test
files if the CI workflow lists more):

```sh
VEIL_DEVNODE_INTEGRATION=1 pnpm vitest run --no-file-parallelism \
  packages/devnode/test/devnodeActions.integration.test.ts \
  packages/provable-sdk/test/integration/devnodeE2e.test.ts \
  packages/provable-sdk/test/integration/devnodeWrite.e2e.test.ts \
  packages/codegen/test/integration/creditsDevnode.e2e.test.ts
```

Live-API verification (read-only, no keys):

```sh
VEIL_INTEGRATION=1 pnpm vitest run --retry=2 \
  packages/core/test/integration/realApi.test.ts \
  packages/shield-swap/test/integration/reads.integration.test.ts \
  packages/shield-swap/test/integration/api.integration.test.ts \
  packages/shield-swap/test/integration/traders.integration.test.ts \
  packages/bridge/test/integration/api.integration.test.ts
```

## 1. @provablehq/sdk (npm)

1. `npm view @provablehq/sdk version` vs the range in
   `packages/provable-sdk/package.json`. Stop here if already current.
2. Bump the range, `pnpm install`, then run `pnpm vitest run` (unit) and the
   devnode verification command.
3. Known breakage patterns:
   - **Consensus version count.** `DEVNODE_CONSENSUS_HEIGHTS` in
     `packages/provable-sdk/src/index.ts` MUST have exactly as many entries as
     the new SDK's consensus-version count AND mirror the
     `CONSENSUS_VERSION_HEIGHTS` default in `packages/devnode/src/index.ts`.
     A short list panics with an opaque wasm `unreachable` inside
     `getOrInitConsensusVersionTestHeights`. Update both files together.
   - Renamed/removed SDK exports surface as type errors in
     `packages/provable-sdk/src/index.ts` — fix the imports, then re-run.
4. Finish with the live-API verification command (the SDK builds transactions
   for those paths too).

## 2. leo (ProvableHQ/leo releases)

1. `gh release list -R ProvableHQ/leo --limit 1` vs `leo --version`.
2. Install the new binary locally (release asset zip or
   `cargo install leo-lang`), then update the pinned `LEO_RELEASE` env in
   `.github/workflows/ci.yml` to the new tag.
3. Run the devnode verification command.
4. Known breakage patterns (all bit at 4.2→4.3):
   - Language syntax changes break the inline Leo sources in
     `packages/provable-sdk/test/integration/devnodeWrite.e2e.test.ts` and
     `devnodeE2e.test.ts` (4.3: `fn` + `final` blocks replaced
     `async transition`/`async function`; explicit `@noupgrade constructor()`
     required; structs moved outside the `program { }` block).
   - Build artifact layout changes break
     `packages/provable-sdk/test/integration/leoProject.ts` (4.3 moved
     `build/main.aleo` → `build/<name>/<name>.aleo`) and the `@veil/leo`
     JSDoc examples.
   - `leo abi` output shape changes break `parseAbi` in
     `packages/core/src/utils/parseAbi.ts` and the codegen round-trip test.

## 3. aleo-devnode (ProvableHQ/aleo-devnode releases)

1. `gh release list -R ProvableHQ/aleo-devnode --limit 1` vs
   `aleo-devnode --version`.
2. Install the new binary locally, update the pinned `DEVNODE_RELEASE` env in
   `.github/workflows/ci.yml`, and run the devnode verification command.
3. Read the release notes (`gh release view <tag> -R ProvableHQ/aleo-devnode`)
   for new node capabilities — new CLI flags, REST endpoints, or lifecycle
   commands. Anything a test or local-dev workflow would drive belongs in the
   SDK as an action:
   - Node lifecycle and process flags → `packages/devnode/src/index.ts`
     (`startDevnode` options, standalone helpers).
   - Live REST controls (the snapshot/advance/shutdown family) → test-client
     actions in `packages/core/src/actions/test/` plus the `TestClient`
     surface, mirroring how `snapshot`/`listSnapshots` were added.
   Each new action needs unit tests, coverage in
   `packages/devnode/test/devnodeActions.integration.test.ts`, and JSDoc per
   `.agents/contributors.md`.
4. Consensus-heights coupling applies here too (see stream 1): if the new
   devnode changes its `CONSENSUS_VERSION_HEIGHTS` default expectations,
   update both mirrored lists.

## 4. aleo-dev-toolkit adaptor packages (npm)

The ProvableHQ/aleo-dev-toolkit monorepo publishes the
`@provablehq/aleo-wallet-adaptor-*` packages consumed here.

1. `npm view @provablehq/aleo-wallet-adaptor-core version` (and `-react`,
   `-shield`, `-leo`, `-puzzle`, `-fox`) vs the pins in
   `packages/react/package.json` (exact versions) and the peer ranges in
   `packages/wallet-adapter/package.json`.
2. Bump, `pnpm install`, then run the consumer tests:

   ```sh
   pnpm vitest run packages/wallet-adapter packages/react
   ```

   and the dApp typecheck (`pnpm --filter @veil/loyalty-dapp exec tsc --noEmit`).
3. Adapter interface changes ripple into `packages/wallet-adapter/src/index.ts`
   and `packages/react/src/provider.tsx` — fix, re-run, and keep
   `apps/loyalty-dapp/` compiling (it is a release blocker per CLAUDE.md).

## Wrap-up

- `pnpm vitest run` green from the repo root.
- CI workflow pins (`LEO_RELEASE`, `DEVNODE_RELEASE`) match the binaries the
  tests ran against.
- Note in the PR body which streams moved and which were already current.
