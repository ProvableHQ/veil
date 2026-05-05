# Veil — Claude Code Instructions

## Git

- Do NOT add `Co-Authored-By` lines to commits
- Do NOT add any AI attribution to commits, PRs, or code

## Keep examples and apps in sync with package APIs

When you change the public API of any `@veil/*` package, also update:

- `examples/e2e-demo.ts` — the canonical end-to-end demo and live integration test
- `apps/loyalty-dapp/` — the reference dApp consumer

After the change, both must:

- Typecheck (`pnpm --filter @veil/loyalty-dapp exec tsc --noEmit` for the dApp; `pnpm vitest run` covers the e2e demo)
- Run cleanly via `pnpm vitest run` from the repo root

A green `pnpm vitest run` plus a clean dApp typecheck is the bar before claiming an API change is complete. Stale examples and a broken reference dApp are a release blocker.
