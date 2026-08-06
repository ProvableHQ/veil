---
'@provablehq/shield-swap-cli': minor
'@provablehq/shield-swap-sdk': minor
---

Move the trader scripts out of `@provablehq/shield-swap-sdk` and into a new
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

Migrating: replace `npx tsx node_modules/@provablehq/shield-swap-sdk/skills/scripts/<name>.ts`
with `npx @provablehq/shield-swap-cli <name>`, and import the session helpers from
`@provablehq/shield-swap-cli/session` rather than by path.
