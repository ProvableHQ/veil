# @veil/bridge

A viem-shaped client for Provable's cross-chain bridge service. The bridge
moves value between Aleo and other chains through third-party swap providers;
this package wraps its REST API (`/bridge/*` on the wallet-services API) as
typed actions on a client, plus an end-to-end `swap` action that also signs
the Aleo deposit. Aleo is always one side of the pair — the service does not
route, say, Ethereum to Solana.

```ts
import { createBridgeClient, httpBridge } from '@veil/bridge'

const client = createBridgeClient({
  transport: httpBridge('https://wallet.api.provable.com'),
})

const { quotes } = await client.getQuotes({
  srcChain: 'ALEO',
  srcAsset: 'ALEO_MAINNET',
  destChain: 'SOLANA',
  destAsset: 'SOL_SOLANA',
  amountIn: '100',
  recipientAddress: solAddress,   // where the SOL lands
  refundAddress: aleoAddress,     // where a failed swap refunds
})
```

## Installation

```sh
pnpm add @veil/bridge @veil/core
```

The read/track actions need only the bridge client. The `swap` action
additionally takes a `@veil/core` `WalletClient` (any signer path — local key
via `@veil/provable-sdk`, or a wallet adapter) to sign the Aleo deposit.

## Providers

Quotes fan out to the providers the service has enabled. Each quote names its
provider, and the order you create is bound to that provider for its whole
lifecycle. Three providers implement bridging today:

| Provider | Code | What it handles |
|---|---|---|
| NEAR Intents | `NEAR_INTENTS` | Native ALEO to majors on other chains (SOL, ETH, USDT, USDC), and inbound to native ALEO. Skips quoting unless `recipientAddress` and `refundAddress` (or `fromAddress`) are present. |
| Halliday | `HALLIDAY` | Inbound routes into Aleo's wrapped assets (ETH → `ETH_ALEO`, USDC → `USDC_ALEO`, BTC → `WBTC_ALEO`), and inbound to native ALEO. Also a fiat on-ramp. |
| Houdini Swap | `HOUDINI` | CEX-routed swaps. Enabled per environment; returning no quotes in production at the time of writing. |

Which providers actually answer depends on two server-side switches — a
registry entry and the provider adapter's own enablement (API keys,
config) — so the set varies by environment and over time. Do not hardcode
provider assumptions; read them from the quotes you get back.

Provider capabilities can also be gated by feature flags. `getFlags()` returns
the current values (for example `near_supports_pub_priv_swaps`); check them
before offering routes the flag gates.

## Routes

A route is a (source asset, destination asset) pair some provider will quote.
Routes appear and disappear — with provider enablement, liquidity, and flags —
so treat any static list as a snapshot. This one is from July 2026,
production:

| Direction | Route | Quoted by |
|---|---|---|
| Aleo → out | `ALEO_MAINNET` → `SOL_SOLANA`, `ETH_MAINNET`, `USDT_TRON`, `USDC_SOLANA` | NEAR Intents |
| In → Aleo | `SOL_SOLANA` → `ALEO_MAINNET` | NEAR Intents, Halliday |
| In → Aleo | `ETH_MAINNET` → `ETH_ALEO`, `USDC_ETH` → `USDC_ALEO`, `BTC_MAINNET` → `WBTC_ALEO` | Halliday |

Aleo's wrapped assets (`ETH_ALEO`, `USDC_ALEO`, …) had no outbound routes at
that snapshot: value comes in as wrapped assets but leaves as native ALEO.

**Getting the current pairs.** There is no routes endpoint; `getQuotes` IS the
discovery mechanism. To learn what is live right now:

1. `GET /common/assets` on the API lists the asset universe — every
   chain-qualified code the bridge knows (29 at the snapshot).
2. Call `getQuotes` for the pair you care about, with `recipientAddress` and
   `refundAddress` set. Quotes back means the route is live; an empty array
   means no enabled provider will take it right now.

A quote request is cheap and moves no funds, so probing a pair before showing
it to a user is the intended pattern.

## Identifiers and units

Three conventions run through every call. Get these wrong and the API rejects
the request with a 400:

- **Chains** are the API's identifiers, case-sensitive: `ALEO`, `SOLANA`,
  `BITCOIN`, `TRON`, and `EVM:<chainId>` for EVM networks (`EVM:1` mainnet,
  `EVM:8453` Base, `EVM:42161` Arbitrum).
- **Assets** are chain-qualified codes from `/common/assets`, never bare
  symbols: `ALEO_MAINNET`, `USDC_ALEO`, `ETH_BASE`. `ALEO` alone is rejected.
- **Amounts** are decimal strings in display units (`"1.5"` ALEO, not
  microcredits), with at most the asset's decimals of precision. Quotes and
  deposit instructions come back the same way. The `swap` action converts to
  atomic units internally when it builds the Aleo transfer; if you build a
  deposit yourself, `parseDecimalAmount(amount, decimals)` does the exact
  string-based conversion.

## Usage

### The one-call path: `swap`

For Aleo-source swaps, `swap` runs the whole flow: quote, pick one, create the
order, sign and broadcast the Aleo unshield deposit through the source asset's
program, and optionally poll the order to completion.

```ts
import { createBridgeClient, httpBridge, swap } from '@veil/bridge'

const bridge = createBridgeClient({
  transport: httpBridge('https://wallet.api.provable.com'),
})

const result = await swap(bridge, {
  wallet: walletClient,                 // @veil/core WalletClient — signs the deposit
  from: { asset: 'ALEO_MAINNET', amount: '100' },
  to: { chain: 'SOLANA', asset: 'SOL_SOLANA', address: solAddress },
  selectQuote: 'best',                  // or 'fastest', or a callback
  poll: true,                           // wait for COMPLETED
  onStage: (s) => console.log(s.status),
})

result.depositTxId   // at1... — the Aleo deposit transition
result.orderId       // track or audit later
result.finalStatus   // present because poll was truthy
```

Compliance-bearing source assets (`USDCX_ALEO`, `USAD_ALEO`) require a
`merkleProof` input for their unshield transition — pass it via
`SwapParameters.merkleProof`; `swap` throws before moving anything if it is
missing. If the API lists an Aleo asset this SDK does not know yet, extend the
program map: pass `aleoAssetMap: { ...DEFAULT_ALEO_ASSET_MAP, NEW_CODE:
{ program: '...', decimals: n } }`.

### Step by step

Use the individual actions when the wallet is not in the same process (a
browser flow where the user's wallet signs), when the source is not Aleo, or
when you want control between steps.

```ts
// 1. Quote. One entry per provider willing to take the route.
const { quotes, meta } = await client.getQuotes({
  srcChain: 'EVM:1',
  srcAsset: 'USDC_ETH',
  destChain: 'ALEO',
  destAsset: 'USDC_ALEO',
  amountIn: '250',
  recipientAddress: aleoAddress,
  refundAddress: ethAddress,
})
// meta.quoteRequestId identifies this request in support escalations.

// 2. Create an order from the quote you picked.
const q = quotes[0]
const order = await client.createOrder({
  providerId: q.provider.id,
  srcChain: q.srcChain, destChain: q.destChain,
  srcAsset: q.srcAsset, destAsset: q.destAsset,
  amountIn: q.amountIn,
  walletAddress: aleoAddress,           // where the bridged funds land
  quoteId: (q.quoteId ?? q.quoteOptionId)!,
})

// 3. Satisfy the deposit instructions. The order does nothing until the
// deposit arrives; unfunded orders expire.
order.depositAddress   // send exactly order.depositAmount here
order.depositMemo      // include when present — omitting it strands funds
order.expiration       // deposit before this

// 4. Track it.
const done = await client.waitForOrder({ id: order.orderId })  // → COMPLETED or throws
const status = await client.getOrder({ id: order.orderId })     // one snapshot
const audit = await client.getOrderAudit({ id: order.orderId }) // + step/provider event log
```

An order moves through stages (`NEW`, `WAITING`, `CONFIRMING`, `EXCHANGING`,
`COMPLETED`, …). `waitForOrder` polls until the target stage and throws
`BridgeOrderFailedError` on a terminal failure (`FAILED`, `EXPIRED`,
`REFUNDED`) or `BridgeTimeoutError` when time runs out. The status DTO's
`steps` array gives the finer-grained deposit_v1 workflow (order created →
awaiting deposit → deposit detected → … → completed).

### Errors

All transport-level failures (4xx/5xx) throw `TransportError` from
`@veil/core` with the response body in the message. Bridge-specific failures
throw `BridgeError` subclasses: `BridgeEnvelopeError` (malformed response
envelope), `BridgeOrderFailedError` (terminal order failure — carries the
order status), `BridgeTimeoutError` (polling deadline hit).

## Agent and MCP tools

Every action ships as an agent tool. `createBridgeAgentTools(client)` (from
`@veil/bridge/agent`) returns core-shaped `AgentTool`s for any agent
framework; `createBridgeMcpServer(client)` (from `@veil/bridge/mcp`) serves
them over MCP. The tools compose with other Veil packages' tools through
core's `toMcpServer`:

```ts
import { createAgentTools } from '@veil/core/agent'
import { toMcpServer } from '@veil/core/mcp'
import { createBridgeAgentTools } from '@veil/bridge/agent'

const server = toMcpServer([
  ...createAgentTools({ client: publicClient }),
  ...createBridgeAgentTools(bridgeClient),
])
```

`bridge_swap` signs and broadcasts with the wallet the host wired into the
client — expose it only to agents you intend to let move funds. The rest
(flags, quotes, order tracking) are read-only against the API, though
`bridge_create_order` does create a real order server-side.

## Integration tests

`test/integration/` runs against the **live** API and its real providers —
never mocked — gated behind `VEIL_INTEGRATION=1` so the default suite stays
offline. The tests are read-only (quotes and error paths; no orders, no
funds), but every quote request does fan out to real provider systems.
`VEIL_BRIDGE_API_URL` overrides the target deployment.

```sh
VEIL_INTEGRATION=1 pnpm exec vitest run packages/bridge/test/integration
```

Route assertions are deliberately loose — only the flagship ALEO → SOL route
is required to quote, everything else asserts invariants of whatever comes
back — because route availability is a moving target.
