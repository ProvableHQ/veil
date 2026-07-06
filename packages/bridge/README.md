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
so treat any static description as a snapshot. The following patterns currently
exist within the Aleo bridge.

| Pattern                              | Example pairs | Quoted by |
|--------------------------------------|---|---|
| Native ALEO → External Pairs         | `ALEO_MAINNET` → `SOL_SOLANA`, `ETH_MAINNET`, `USDT_TRON`, `USDC_SOLANA`, … | NEAR Intents |
| External Pairs → Native ALEO         | `SOL_SOLANA` → `ALEO_MAINNET`, `ETH_MAINNET` → `ALEO_MAINNET`, … | NEAR Intents, Halliday |
| External Pairs → Aleo Wrapped Assets | `ETH_MAINNET` → `ETH_ALEO`, `USDC_ETH` → `USDC_ALEO`, `BTC_MAINNET` → `WBTC_ALEO` | Halliday |

### Getting the supported pairs

#### Step 1: Discovering Possible Routes
`getRoutes()` finds the routes from the asset catalog. This function returns 
an array of asset pairs (src asset, destination asset) that share a supporting 
provider and provide the metadata needed to get quotes.

```typescript
// Data returned from getRoutes().
{
  aleoAsset:  { code: 'ALEO_MAINNET', chain: 'ALEO', chainName: 'Aleo', symbol: 'ALEO', … },
  externalAsset: { code: 'USDC_BASE', chain: 'EVM:8453', chainName: 'Base', symbol: 'USDC', … },
  providers: ['NEAR_INTENTS', 'HALLIDAY'],
}
```

#### Step 2: Determining if a Quote Exists

The routes returned by `getRoutes()` are candidate routes. 

Callers must call get `getQuotes()` to ensure a particular `pair` and `direction` `(Aleo -> External, External -> Aleo)`,
is available to bridge (Note the `recipientAddress` and a `refundAddress` must be set). Receiving an empty array 
means no enabled provider supports the route at the time of the quote.

```ts
// Everywhere USDC can move relative to Aleo:
const routes = await bridge.getRoutes({ symbol: 'USDC' })
const r = routes[0]
r.externalAsset.code       // 'USDC_ETH'
r.externalAsset.chainName  // 'Ethereum' (human-readable; chain id is 'EVM:1')
r.providers                // ['HALLIDAY']

// Get a quote to see if the route exists.
const { quotes, meta } = await client.getQuotes({
  srcChain: 'Ethereum',
  srcAsset: 'USDC',
  destChain: 'Aleo',
  destAsset: 'USDC',
  amountIn: '250',
  recipientAddress: aleoAddress,
  refundAddress: ethAddress,
})
```

`getQuotes` returns one entry per provider willing to take the route, plus a
`meta` block. A live capture (ALEO → SOL, trimmed):

```typescript
// Data returned from getQuotes().
{
  quotes: [
    {
      provider: { id: 'ab26…', code: 'NEAR_INTENTS', displayName: 'NEAR Intents', … },
      srcChain: 'ALEO',                // resolved identifiers echoed back,
      destChain: 'SOLANA',             // even when you passed names/symbols
      srcAsset: 'ALEO_MAINNET',
      destAsset: 'SOL_SOLANA',
      amountIn: '100',                 // decimal display units throughout
      amountOut: '0.023951296',        // estimated receive amount
      minAmountOut: '0.023711783',     // slippage floor
      estimatedTimeSeconds: 900,
      quoteId: '1089843a-…',           // → createOrder's quoteId (some routes use quoteOptionId)
      integrationType: 'CEX',
      feeEstimate: { provider: { feeUsd: '0.020501', … }, appFeeBps: 5, appFeeAmountIn: '0.05' },
      metadata: { amountInAtomic: '100000000', amountOutAtomic: '23951296', … },
      destChainWalletValidationRegex: '^[1-9A-HJ-NP-Za-km-z]{32,44}$',
    },
  ],
  meta: {
    count: 1,
    quoteRequestId: '98b21e5f-…',      // support handle — log it
    // warnings / providerErrors appear here when providers skip or fail
  },
}
```

The fields that matter downstream: `quoteId` (or `quoteOptionId`) and
`provider.id` are what `createOrder` takes; the echoed `srcAsset`/`destAsset`
are the resolved codes; and `destChainWalletValidationRegex` validates the
recipient before committing.

## Identifiers and units

Three conventions run through every call. Get these wrong and the API rejects
the request with a 400. Do not hardcode or guess the values — they all come
from `getAssets()`:

- **Chains** are the API's identifiers, case-sensitive: `ALEO`, `SOLANA`,
  `BITCOIN`, `TRON`, and `EVM:<chainId>` for EVM networks (`EVM:1` mainnet,
  `EVM:8453` Base, `EVM:42161` Arbitrum). Read them from the catalog's
  `chain` field. For display, `chainDisplayName('EVM:8453')` → `'Base'` — a
  client-side map for now, until the API exposes its chain registry.
- **Assets** are chain-qualified codes, never bare symbols: `ALEO_MAINNET`,
  `USDC_ALEO`, `ETH_BASE`. `ALEO` alone is rejected. Read them from the
  catalog's `code` field.
- **Amounts** are decimal strings in display units (`"1.5"` ALEO, not
  microcredits), with at most the asset's `decimals` of precision. Quotes and
  deposit instructions come back the same way. The `swap` action converts to
  atomic units internally when it builds the Aleo transfer; if you build a
  deposit yourself, `parseDecimalAmount(amount, decimals)` does the exact
  string-based conversion.

`getQuotes` and `swap` soften both rules for you: chains resolve from display
names locally, and asset symbols resolve against the catalog within their
chain (one extra `getAssets` fetch, only when a symbol is passed — exact
codes keep the single request). `createOrder` stays strict: echo the chosen
quote, which carries the resolved codes.

The literal codes in this README's examples are real, but they are snapshots —
resolve them at runtime the way the example above does.

## Usage

### The one-call path: `swap`

For Aleo-source swaps, `swap` runs the whole flow: quote, pick one, create the
order, sign and broadcast the Aleo unshield deposit through the source asset's
program, and optionally poll the order to completion. The signing wallet is
client configuration, viem-style — set it once at construction and every
`bridge.swap()` uses it (a per-call `wallet` overrides it).

```ts
import { createBridgeClient, httpBridge } from '@veil/bridge'

const bridge = createBridgeClient({
  transport: httpBridge('https://wallet.api.provable.com'),
  wallet: walletClient,                 // @veil/core WalletClient — signs deposits
})

const result = await bridge.swap({
  from: { asset: 'ALEO_MAINNET', amount: '100' },   // from.chain optional; must be Aleo
  to: { chain: 'Solana', asset: 'SOL_SOLANA', address: solAddress }, // chain by id or name
  selectQuote: 'best',                  // or 'fastest', or a callback
  poll: true,                           // wait for COMPLETED
  onStage: (s) => console.log(s.status),
})

result.depositTxId   // at1... — the Aleo deposit transition
result.orderId       // track or audit later
result.finalStatus   // present because poll was truthy
```

Chain slots accept the API identifier or the display name (`'Solana'`,
`'Ethereum'`), case-insensitively. Three more optional knobs: `provider`
pins quote selection to one provider by code (`'NEAR_INTENTS'`) and throws
before any funds move if it did not quote — the natural follow-through when
the user picked from a `getRoutes` candidate's `providers`; `refundAddress`
redirects refunds away from the default (the signing wallet's address); and
`from.chain` exists for shape-stability — it defaults to `'ALEO'` and must
resolve to Aleo, since this action signs the deposit with the Aleo wallet.

Every action also exists in viem's standalone, tree-shakable form
(`import { swap } from '@veil/bridge'` then `swap(client, params)`) for
bundle-sensitive consumers; the client form above is the primary API.

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
// 1. Quote. One entry per provider willing to take the route. Chains accept
// ids or display names, assets accept codes or symbols (resolved per chain).
const { quotes, meta } = await client.getQuotes({
  srcChain: 'Ethereum',
  srcAsset: 'USDC',
  destChain: 'Aleo',
  destAsset: 'USDC',
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

## Swapping bridged assets on Shield Swap

Bridged-in value lands as an Aleo asset (USDC on Ethereum arrives as
`USDC_ALEO`, ETH as `ETH_ALEO`), and from there it is ordinary Aleo money —
including tradeable on the Shield Swap DEX via `@veil/shield-swap`. Both
packages hang off the same `@veil/core` wallet client, so one signer runs the
whole chain: bridge in, trade privately, bridge back out.

```ts
import { createBridgeClient, httpBridge } from '@veil/bridge'
import { shieldSwapActions } from '@veil/shield-swap'
import { createWalletClient, custom, erc20Abi, parseUnits } from 'viem'
import { mainnet } from 'viem/chains'

// One Aleo wallet client, two Veil surfaces.
const bridge = createBridgeClient({
  transport: httpBridge('https://wallet.api.provable.com'),
  wallet: walletClient,
})
const dex = walletClient.extend(shieldSwapActions({ api: {} }))

// 1. Bridge in: pick the route from the graph, quote it, create the order.
const [route] = await bridge.getRoutes({ symbol: 'USDC', externalChain: 'Ethereum' })
const { quotes } = await bridge.getQuotes({
  srcChain: route.externalAsset.chain, srcAsset: route.externalAsset.code,
  destChain: route.aleoAsset.chain, destAsset: route.aleoAsset.code,
  amountIn: '250',
  recipientAddress: aleoAddress, refundAddress: ethAddress,
})
const q = quotes[0]
const order = await bridge.createOrder({
  providerId: q.provider.id,
  srcChain: q.srcChain, destChain: q.destChain,
  srcAsset: q.srcAsset, destAsset: q.destAsset,
  amountIn: q.amountIn,
  walletAddress: aleoAddress,           // where the bridged USDC lands
  quoteId: (q.quoteId ?? q.quoteOptionId)!,
})

// 2. Pay the deposit from the user's EVM wallet — this side is plain viem.
const evm = createWalletClient({ chain: mainnet, transport: custom(window.ethereum) })
const [ethAccount] = await evm.getAddresses()
await evm.writeContract({
  account: ethAccount,
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
  abi: erc20Abi,
  functionName: 'transfer',
  args: [order.depositAddress as `0x${string}`, parseUnits(order.depositAmount!, 6)],
})
await bridge.waitForOrder({ id: order.orderId }) // USDC_ALEO arrives

// 3. Trade on the DEX: privatize, swap, claim.
const handle = await dex.swapPrivate({ poolKey, tokenInId, amountIn, slippageBps: 50, tokenInProgram, imports })
await dex.claimSwapOutputPrivate({ handle, imports })

// 4. Bridge back out — one call, deposit signed by the same Aleo wallet.
await bridge.swap({
  from: { asset: 'ALEO_MAINNET', amount: '100' },
  to: { chain: 'Solana', asset: 'SOL_SOLANA', address: solAddress },
  poll: true,
})
```

The whole chain is exercised by
[`packages/shield-swap/test/integration/bridgeRoundTrip.e2e.test.ts`](../shield-swap/test/integration/bridgeRoundTrip.e2e.test.ts),
which also documents the two seams to know about: the inbound deposit needs a
source-chain signer, and the DEX currently runs on testnet while the bridge is
mainnet.

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
(discovery, flags, quotes, order tracking) are read-only against the API,
though `bridge_create_order` does create a real order server-side. The
discovery tools matter for agents especially: `bridge_list_assets`,
`bridge_list_routes`, and `bridge_list_providers` give the model the chain
ids, asset codes, chain names, decimals, and provider support it must not
guess — the descriptions steer it to discover before quoting, and
`bridge_list_routes` answers "what can move where" directly.

## Integration tests

`test/integration/` runs against the **live** API and its real providers —
never mocked — in two tiers, gated so the default suite stays offline.
`VEIL_BRIDGE_API_URL` overrides the target deployment for both.

**Read-only tier** (`api.integration.test.ts`) needs only
`VEIL_INTEGRATION=1`. Quotes and error paths; no orders, no funds — though
every quote request does fan out to real provider systems.

```sh
VEIL_INTEGRATION=1 pnpm exec vitest run packages/bridge/test/integration/api.integration.test.ts
```

Route assertions are deliberately loose — everything asserts invariants of
whatever comes back, because route availability is a moving target. One
reference route (native ALEO → native SOL) is required to quote: it is the
pair that consistently quotes in production today, so its silence signals a
regression rather than shifting liquidity.

**Swap e2e tier** (`e2e.test.ts`) runs the whole chain on **mainnet**: quote,
create the order, sign and broadcast the Aleo unshield deposit, poll the
order to `COMPLETED`, and audit it. This spends real ALEO and delivers real
SOL, so it takes an explicit second gate on top of the integration flag plus
a mainnet-funded account and proving credentials:

```sh
VEIL_INTEGRATION=1 VEIL_BRIDGE_E2E=1 \
  pnpm exec vitest run packages/bridge/test/integration/e2e.test.ts
```

Requires `VEIL_E2E_PRIVATE_KEY` (funded on mainnet), `ALEO_DPS_API_KEY`, and
`ALEO_CONSUMER_ID`. `VEIL_BRIDGE_SWAP_AMOUNT` sets the decimal ALEO to swap
(default `5` — providers reject amounts below their minimums) and
`VEIL_BRIDGE_DEST_ADDRESS` the Solana recipient. The test shields a private
record first when none covers the deposit, and fails before moving funds if
no provider quotes the route.
