---
'@provablehq/veil-aleo-sdk': minor
'@provablehq/shield-swap-sdk': minor
'@provablehq/veil-aleo-devnode': minor
---

Bump `@provablehq/sdk` to `^0.11.6`.

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
