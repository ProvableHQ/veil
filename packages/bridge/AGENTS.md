# @provablehq/veil-aleo-bridges — agent guide

Working notes for coding agents editing this package. The repo-wide
contributor constraints in the root `AGENTS.md` / `.agents/contributors.md`
still bind here (JSDoc on every export, sign-off before changing a
depended-on package's interface, no AI attribution in commits). This file
adds package-specific how-to.

## What this is

A viem-shaped client for Provable's cross-chain bridge (the `/bridge/*` and
`/common/*` endpoints of the wallet-services API): discovery (assets,
providers, derived routes), quotes, orders and tracking, and an end-to-end
Aleo-source `swap` that signs the unshield deposit with a `@provablehq/veil-core`
WalletClient. Agent/MCP tool surfaces ship under `@provablehq/veil-aleo-bridges/agent` and
`/mcp`, in core's composable `AgentTool` shape.

## Commands (run from the repo root)

```sh
pnpm --filter @provablehq/veil-aleo-bridges exec tsc --noEmit   # typecheck
pnpm vitest run packages/bridge                # offline suite (integration auto-skips)
pnpm --filter @provablehq/veil-aleo-bridges build               # tsup → dist (+ dist/agent, dist/mcp; build @provablehq/veil-core first in a fresh checkout)
```

## Tests

Integration tests hit the **real** wallet-services API and its providers
(never mocked — they exist to catch drift) and are gated so the default
`pnpm vitest run` stays fast. Two tiers:

- **`VEIL_INTEGRATION=1`** — the read-only tier
  (`api.integration.test.ts`): discovery, quotes, error paths. No account,
  no funds — though quote requests do fan out to real provider systems.
- Plus **`VEIL_BRIDGE_E2E=1`**, **`VEIL_E2E_PRIVATE_KEY`** (funded on
  MAINNET), **`ALEO_DPS_API_KEY`**, **`ALEO_CONSUMER_ID`** — the swap-chain
  e2e (`e2e.test.ts`). It SPENDS REAL ALEO and delivers real SOL; run it
  deliberately. Knobs: `VEIL_BRIDGE_SWAP_AMOUNT`, `VEIL_BRIDGE_DEST_ADDRESS`,
  `VEIL_BRIDGE_API_URL`.
- The inbound e2e (`inbound.e2e.test.ts`) additionally needs
  **`ETH_PRIVATE_KEY`** (an Ethereum account with USDC + gas) — viem signs
  the source-chain deposit. It spends real USDC; once the deposit is sent,
  recovery is the provider's refund path, not a revert.
- The cross-product round trip (bridge in → DEX swap → bridge out) lives in
  `packages/shield-swap/test/integration/bridgeRoundTrip.e2e.test.ts`.

## Architecture you must respect

- **Discovery over hardcoding.** Chain ids are case-sensitive (`ALEO`,
  `EVM:1`), asset codes chain-qualified (`ALEO_MAINNET`), and both come from
  `getAssets()`/`getRoutes()` at runtime. Never bake identifiers into logic;
  tests select routes from the graph by symbol + chain name.
- **Wire types stay honest.** Types mirroring API responses
  (`BridgeAssetSummary`, `BridgeQuote`, the DTOs) must not grow fields the
  server does not return. Client-derived data rides on derived types
  (`RouteAsset` adds `chainName`) in derived views (`getRoutes`).
- **Chain names are a stopgap.** `chainDisplayName`/`resolveChainId` read a
  client-side map (`src/lib/chain-names.ts`) because no endpoint exposes the
  server's chain registry yet; the file is marked for deletion once
  `GET /common/chains` ships. Nothing may call or assume that endpoint.
- **The API is the source of truth for amounts.** Everything is decimal
  display strings on the wire; scale to atomic units only at the Aleo
  transfer (`parseDecimalAmount`), preferring the order's own
  `assetDecimals` over the local asset map.
- **swap is Aleo-source only** — it signs the deposit with the Aleo wallet.
  The constraint is enforced by validation on `from.chain` (default
  `'ALEO'`), not by the parameter shape, so it can be relaxed without a
  breaking change. Inbound flows go through `getQuotes` + `createOrder`,
  deposit paid on the source chain.
- **createOrder's `walletAddress` is the payout recipient** (the
  destination-chain address), never the Aleo signer — the server does not
  fall back to the quote's recipient. `refundAddress` defaults to the
  signer.
- **token_registry caveat.** Registry-token deposits identify the token by
  the spent record; record selection cannot yet be pinned to a token id, so
  a wallet holding several registry tokens may spend the wrong one — keep
  the warning in `swap`'s JSDoc intact.
- **Fail before funds move.** Local validation (asset map, merkle proof,
  provider pin, source chain) runs before any network call; deposit-
  instruction guards (memo, missing address/amount) run before signing.

## Using the agent tools

Tools are core-shaped `AgentTool`s ({ schema, handler }) and compose with
other packages via core's `toMcpServer`:

```ts
import { createBridgeAgentTools } from '@provablehq/veil-aleo-bridges/agent'
import { createBridgeMcpServer } from '@provablehq/veil-aleo-bridges/mcp'
import { toMcpServer } from '@provablehq/veil-core/mcp'

const tools = createBridgeAgentTools(bridgeClient)
const server = createBridgeMcpServer(bridgeClient) // or toMcpServer([...tools, ...others])
```

Rules that matter when wiring these up:

- **Discovery tools first.** `bridge_list_assets` / `bridge_list_routes` /
  `bridge_list_providers` exist so models never guess identifiers; their
  descriptions steer the model to call them before quoting.
- **`bridge_swap` moves funds.** It signs with the wallet the host wired
  into the client — only expose it to agents allowed to spend.
  `bridge_create_order` creates a real server-side order (harmless unfunded,
  but real).
- Everything else is read-only against the API.

## Layout

```
src/actions/     one file per action (discovery, quotes, orders, swap)
src/clients/     createBridgeClient + the bridgeActions decorator
src/transports/  httpBridge (method → HTTP route mapping)
src/lib/         aleo-asset map, chain-names stopgap
src/utils/       envelope unwrap, exact decimal units
src/agent/       core-shaped agent tools (@provablehq/veil-aleo-bridges/agent)
src/mcp/         MCP server binding (@provablehq/veil-aleo-bridges/mcp)
src/types/       wire types (API mirrors) + envelope
```
