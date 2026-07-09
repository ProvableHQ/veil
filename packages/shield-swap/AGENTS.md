# @provablehq/shield-swap-sdk — agent guide

Working notes for coding agents editing this package. The repo-wide contributor
constraints in the root `AGENTS.md` / `.agents/contributors.md` still bind here
(JSDoc on every export, sign-off before changing a depended-on package's
interface, no AI attribution in commits). This file adds package-specific how-to.

## What this is

A viem-shaped client for the `shield_swap` AMM on Aleo: chain-direct reads +
writes as tree-shakable actions, a typed off-chain API client under `.api`, and
composition via `shieldSwapActions()` + viem's `extend()`. Agent/MCP tool
surfaces ship under the `@provablehq/shield-swap-sdk/agent` and `/mcp` subpaths.

## Commands (run from the repo root)

```sh
pnpm --filter @provablehq/shield-swap-sdk exec tsc --noEmit   # typecheck
pnpm vitest run                                      # offline suite (integration auto-skips)
pnpm --filter @provablehq/shield-swap-sdk build                # tsup → dist (also emits dist/agent, dist/mcp)
```

Codegen (only when upstream shapes change — see the README's Codegen section):

```sh
pnpm --filter @provablehq/shield-swap-sdk generate       # ABI → src/generated/shield_swap.ts
pnpm --filter @provablehq/shield-swap-sdk regen-abi       # refetch program bytecode + ABI (defaults to v0_0_2)
pnpm --filter @provablehq/shield-swap-sdk regen-openapi   # refetch OpenAPI spec → src/api/openapi.ts
```

## Tests

Integration tests hit the **real** testnet node + DEX API (never mocked — they
exist to catch drift) and are gated so the default `pnpm vitest run` stays fast.
Run them during development when touching anything they cover.

- **`VEIL_INTEGRATION=1`** — enables the read-only tiers (`reads.integration`,
  `api.integration`). No account needed.
- Plus **`VEIL_E2E_PRIVATE_KEY`** (funded testnet account) and
  **`ALEO_DPS_API_KEY`** + **`ALEO_CONSUMER_ID`** (delegated proving + scanner
  auth) — enables the full lifecycle (`e2e`) and the balance tests
  (private balances need the account's records).
- Optional: `VEIL_DEX_PROGRAM` (default `shield_swap_v0_0_2.aleo`), `ALEO_DPS_URL`,
  `ALEO_RSS_URL`.

```sh
VEIL_INTEGRATION=1 pnpm exec vitest run packages/shield-swap/test/integration
```

## Architecture you must respect

- **Two signer paths.** Every private action supports a **local signer** (SDK /
  private key — passes raw literals, selects records via the record provider,
  derives the blinded identity from the view key) and a **wallet signer**
  (Shield-like — supplies records as `record` InputRequests and derives
  wallet-side via `derived` requests). InputRequests are wallet-only; local
  signers MUST pass literals. Keep both paths working when you touch an action.
- **Trust boundary.** Chain reads are consensus-backed and sit flat on the
  client; the off-chain API is a trusted convenience layer under `.api`. Values
  that gate money movement (swap outputs, blinded-address usage) come from chain
  reads, never the API.
- **Bindings are generated.** `src/generated/` and `src/api/openapi.ts` are
  codegen output — edit the source (ABI / config / OpenAPI spec) and regenerate,
  don't hand-edit. `PROGRAM_ID` targets the live deployment (`v0_0_2`), generated from its own
  ABI; see the README's Codegen section.

## Using the agent tools

This package exposes its actions as agent tools so an LLM can drive the DEX.
Build a client, then get tools or an MCP server from it.

Framework-agnostic tools (schema + handler) — feed to LangChain, the Vercel AI
SDK, etc.:

```ts
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'
import { createShieldSwapAgentTools } from '@provablehq/shield-swap-sdk/agent'

const client = walletClient.extend(shieldSwapActions({ api: {} }))
const tools = createShieldSwapAgentTools({ client, api: client.api })
// each: { schema: { name, description, inputSchema }, handler: (input) => Promise<result> }
```

As an MCP server (`{ tools, handleToolCall }`):

```ts
import { createShieldSwapMcpServer } from '@provablehq/shield-swap-sdk/mcp'

const server = createShieldSwapMcpServer({ client, api: client.api })
const pools = await server.handleToolCall('shield_swap_list_pools', { limit: 5 })
```

Rules that matter when wiring these up:

- **Gating by backing.** Read tools appear when `client` is set; API tools when
  `api` is set; `shield_swap_get_balances` needs both. `shieldSwapAgentToolSchemas()`
  (no config) returns every schema for registration-only use.
- **Writes are opt-in.** Money-moving tools (`swap`, `claim`, `mint`,
  `increase_liquidity`, `create_pool`) are excluded unless you pass
  `includeWrites: true` (and a `client`). Only enable them for an agent you
  intend to let move funds.
- **Params are LLM-shaped.** Amounts are strings (raw base units); the agent
  passes token programs and amounts — handlers auto-fetch `imports` and
  auto-select records. `shield_swap_claim` takes the handle `shield_swap_swap`
  returned. Results are JSON-safe (bigints rendered as strings).
- **Combine with base Aleo tools** via core's adapter:
  `toMcpServer([...createAgentTools(cfg), ...createShieldSwapAgentTools(cfg)])`.

## Layout

```
src/actions/   reads/ swap/ liquidity/ — the (client, params) actions
src/utils/     pure helpers (tick math, params, derivations) + records/balances + blinding/
src/api/       ApiClient + generated openapi types
src/agent/     agent tool schemas + handlers (@provablehq/shield-swap-sdk/agent)
src/mcp/       MCP server wrapper (@provablehq/shield-swap-sdk/mcp)
src/generated/ codegen output
codegen/       pinned ABI + OpenAPI inputs, config, regen scripts
```
