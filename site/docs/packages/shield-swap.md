---
sidebar_position: 6
---

# @provablehq/shield-swap-sdk

`@provablehq/shield-swap-sdk` is a viem-shaped client for `shield_swap_v3.aleo`, the
concentrated-liquidity AMM on Aleo: private two-phase swaps, liquidity
management, direct on-chain reads, and a typed off-chain DEX API — all
composed onto one client via `extend()`. Chain reads and writes sit flat on
the client (`client.getPool`, `client.swap`); the DEX API sits under
`client.api`, so a call site always shows whether a value came from the
chain or the service.

The [Integrating Shield Swap guide](/guides/shield-swap) walks the full
flow — client setup, quote, the two-phase swap and claim, liquidity, and
balances. The [`/api/shield-swap`](/api/shield-swap/swap) reference pages
document each action's parameters, return shape, and errors.

## Installation

```bash
npm install @provablehq/veil-core @provablehq/shield-swap-sdk
```

Signing with a local private key also needs `@provablehq/sdk` as a peer — it
derives the blinded identity a private swap is claimed with. A connected
wallet performs that derivation itself, so the dependency is not needed on
the wallet path.

## Client pairings

The signer determines which `@provablehq/veil-core` client
`shieldSwapActions` extends. In a browser dApp, pair it with
`@provablehq/veil-aleo-react-hooks`; the connected wallet holds the keys and
records and proves, so the app carries no key, proving config, or scanner.
In a bot, script, or agent trader, pair it with `@provablehq/veil-aleo-sdk`
for a local key with delegated or local proving. Read-only pool and price
queries need only a `PublicClient` over a transport — no key, proving, or
scanner.

## Example

A local-key client swapping on testnet. `createAleoClient` wires the
account, transport, and proving config in one call; the scanner finds the
private records the swap spends.

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const aleo = await loadNetwork('testnet')
const { walletClient } = aleo.createAleoClient({
  privateKey: PRIVATE_KEY,
  networkUrl: 'https://api.provable.com/v2',
  provingMode: 'delegated',
  proverUrl: 'https://api.provable.com/prove/testnet',
  apiKey: DPS_API_KEY,
  consumerId: CONSUMER_ID,
  records: aleo.createRemoteScanner({
    url: 'https://api.provable.com/scanner',
    consumerId: CONSUMER_ID,
    apiKey: DPS_API_KEY,
  }),
})
const client = walletClient.extend(
  shieldSwapActions({ api: { baseUrl: 'https://amm-api.dev.provable.com' } }),
)

const handle = await client.swap({
  poolKey,
  tokenInId,
  amountIn: 1_000_000n,     // raw atomic amount, bigint
  expectedOut,              // a real quote, scaled to base units
  slippageBps: 50,          // 0.5%
  tokenInProgram,           // the token's wrapper program
  imports,                  // token program sources for dynamic dispatch
})
// …then claim once the request finalizes:
const { amountOut } = await client.claimSwapOutput({ handle, imports })
```

The [guide](/guides/shield-swap) shows where each input comes from — pool
discovery, quoting, the `imports` map — and the wallet-signer variants.

## Key exports

- **`shieldSwapActions(config)`** — the `extend()` decorator; chain
  reads/writes flat on the client, the DEX API under `.api`. Defaults to
  `shield_swap_v3.aleo` and the Provable API; override with
  `shieldSwapActions({ program, api: { baseUrl } })`.
- **Swaps** — [`swap`](/api/shield-swap/swap) →
  [`claimSwapOutput`](/api/shield-swap/claimSwapOutput) (the two-phase
  private swap), the serializable `SwapHandle` between them, and
  `SwapOutputNotFinalizedError` for the retry loop.
- **Liquidity** — [`createPool`](/api/shield-swap/createPool),
  [`mint`](/api/shield-swap/mint),
  [`increaseLiquidity`](/api/shield-swap/increaseLiquidity),
  [`decreaseLiquidity`](/api/shield-swap/decreaseLiquidity),
  [`collect`](/api/shield-swap/collect), [`burn`](/api/shield-swap/burn).
- **Reads** — [`getPool`](/api/shield-swap/getPool),
  [`getSlot`](/api/shield-swap/getSlot),
  [`getSwapOutput`](/api/shield-swap/getSwapOutput); combined balances via
  `getBalances` and `getPrivateBalances`.
- **DEX API auth** — `client.authenticateApi()` (session handshake signed by
  the account, auto-renewing) and `ApiClient.createApiToken` /
  `listApiTokens` / `revokeApiToken` for long-lived `ss_…` keys passed as
  `api: { apiToken }`. Most API endpoints beyond discovery are bearer-gated —
  see the [guide](/guides/shield-swap#authenticating-with-the-dex-api).
- **Wallet grants** — `SHIELD_SWAP_ALGORITHM_GRANTS`,
  `shieldSwapAlgorithmGrants` — the connect-time algorithm allowlist a
  wallet-signer setup passes so the wallet may derive blinded identities.

## Subpaths

- **`@provablehq/shield-swap-sdk/agent`** — `createShieldSwapAgentTools({ client, api, includeWrites? })` and `shieldSwapAgentToolSchemas()`. Read tools are included by default; money-moving write tools are opt-in via `includeWrites`.
- **`@provablehq/shield-swap-sdk/mcp`** — `createShieldSwapMcpServer({ client, api })`.

The package README covers program imports and codegen in full:
[README](https://github.com/ProvableHQ/veil/blob/main/packages/shield-swap/README.md).
