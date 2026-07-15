# Developing: build an app on Shield Swap

Goal: guide a developer who is building something on Shield Swap — a
frontend dApp, a trading bot, a server integration, or an agent — rather
than trading interactively. The trading runbooks double as living
integration references; this runbook maps what they want to build onto the
SDK and points at the deep documentation.

Start by asking what they are building — the client choice follows from
where the signing keys live:

| Building | Packages | Keys live |
| --- | --- | --- |
| Browser dApp | `@provablehq/veil-aleo-react-hooks` + wallet adapters + `@provablehq/shield-swap-sdk` | The user's wallet (Shield, Leo, Puzzle, Fox) signs and proves; the app carries no key or proving config. |
| Bot / server / CLI | `@provablehq/veil-aleo-sdk` + `@provablehq/shield-swap-sdk` | A local private key; delegated proving through the Provable prover (fees covered via FeeMaster by default). |
| Agent integration | `@provablehq/shield-swap-sdk/agent` (tool schemas) and `/mcp` (MCP server), over either client above | Same as the underlying client; the tools bind to it. |

## Where the deep documentation lives

- **Package README** — the SDK's API surface with examples:
  `packages/shield-swap/README.md` in the repo, or
  `node_modules/@provablehq/shield-swap-sdk/README.md` from npm.
- **Repo AGENTS.md ("Using Veil")** — the package map and the common
  setups (frontend, bot, agent), including Provable API registration.
- **Documentation site** — guides and per-action API references under
  `site/docs/` (`guides/shield-swap.md` is the end-to-end walkthrough;
  `guides/agents.md` covers the tool surface).
- **Runnable examples** — `examples/shield-swap-swap.ts` (two-phase
  private swap), `examples/shield-swap-liquidity.ts` (pool + position
  lifecycle), `examples/agent-usage.ts` (agent tools).
- **These skills' scripts** — `scripts/session.ts` and `scripts/setup.ts`
  are a working reference implementation of user onboarding (registration,
  code redemption, airdrop, credential storage); an app onboarding its own
  users walks the same gauntlet.

## What every integration must handle

These are load-bearing regardless of client choice — each is covered in
depth in the trading runbooks:

- **Auth is layered**: a bearer credential (session JWT from the
  challenge/verify handshake the user's wallet signs, or a server-held
  `ss_…` API token) AND a one-time invite/referral redemption per account
  ([startup.md](./startup.md)).
- **Writes need the full imports map** — `resolveDexImports` builds it
  (token programs + the DEX program's own static imports)
  ([swapping.md](./swapping.md)).
- **Tokens are private records**: balances users can spend do not appear
  in public balance reads; one covering record funds an amount, no
  aggregation ([swapping.md](./swapping.md)).
- **Amounts obey the no-dust rule** on the way in AND on collect
  ([collecting.md](./collecting.md)); display in human units, transact in
  raw base units.
- **A `SwapHandle` is the only key to a swap's output** — persist it
  before anything else, claim after finalize with retry
  ([swapping.md](./swapping.md), [collecting.md](./collecting.md)).
- **Concurrency needs partitioned blinded-identity counters and disjoint
  input records** ([swapping.md](./swapping.md)).

## Suggested path for a new integrator

1. Run [startup.md](./startup.md) to get a working funded account — it
   doubles as a test fixture for their app.
2. Walk one flow end-to-end with the runbook snippets (swap → claim) so
   the mechanics are concrete.
3. Read the package README for the API surface their app needs, and copy
   the closest example as a starting point.
4. Wire their client choice from the table above; keep the caveat list
   as a review checklist for their integration.
