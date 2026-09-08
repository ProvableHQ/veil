# Veil — Claude Code Instructions

Repo-wide contributor constraints live in `AGENTS.md` and apply here:

@AGENTS.md

## Git

- Do NOT add `Co-Authored-By` lines to commits
- Do NOT add any AI attribution to commits, PRs, or code

## Before committing code

Before any commit that touches code (skip for docs-only commits), run
`/code-review low` on the diff and address its findings, then commit.

Keep reviews cheap. Always pass `low` to `/code-review`; never run it at
`medium` or above, and never fan out parallel review agents (`/simplify`'s
four-agent pass included) unless the user explicitly asks for that scale.
One low-effort review is the bar.

## Keep examples and apps in sync with package APIs

When you change the public API of any `@provablehq/veil-*` package, also update:

- `examples/e2e-demo.ts` — the canonical end-to-end demo and live integration test
- `apps/loyalty-dapp/` — the reference dApp consumer

After the change, both must:

- Typecheck (`pnpm --filter @provablehq/veil-loyalty-dapp exec tsc --noEmit` for the dApp; `pnpm vitest run` covers the e2e demo)
- Run cleanly via `pnpm vitest run` from the repo root

A green `pnpm vitest run` plus a clean dApp typecheck is the bar before claiming an API change is complete. Stale examples and a broken reference dApp are a release blocker.
