---
sidebar_position: 2.1
---

# swapMultiHop

Requests a private multi-hop swap — phase one of the two-transaction
lifecycle, across 2–3 pools in one atomic transaction.

Resolves the route against live pool state, obtains a single-use blinded
identity and a token record, and submits the `swap_multi_hop` transition on
`shield_swap_v3.aleo`. The intermediate tokens never touch the trader's
account. The chain computes the outcome at finalize; read it back with
[`getSwapOutput`](/api/shield-swap/getSwapOutput) and collect it with
[`claimMultiHopOutput`](/api/shield-swap/claimMultiHopOutput). The action
hits the network for per-hop pool reads, a deadline read, a record scan, and
the transaction itself; it signs, and on the local-signer path proves
locally.

The client walks the input token through each pool's pair to fix hop
directions and the final output token, and throws when the route does not
connect. The contract asserts `2 <= hop_count <= 3` — a single-hop trade
uses [`swap`](/api/shield-swap/swap).

Signer paths mirror `swap`: a local account auto-selects the record and
returns a handle already carrying `swapId` and `blindedAddress`; a wallet
account must supply `tokenRecord` and gets those fields filled only when it
also supplied `blindedIdentity` (and `@provablehq/sdk` is installed).

## Usage

```ts
const handle = await client.swapMultiHop({
  poolKeys: [ethUsdcPool, usdcAleoPool],   // ETH → USDC → ALEO, route order
  tokenInId: ethTokenId,
  amountIn: 10n ** 18n,
  expectedOut,                             // quote for the FINAL output token
  slippageBps: 50,                         // applied once, end to end
  tokenInProgram: 'ethx_5a095e.aleo',
  imports,
})
// …await finalize, then:
const res = await client.claimMultiHopOutput({ handle, imports })
```

## Returns

`Promise<MultiHopSwapHandle>`

The serializable claim thread — persist it; the claim consumes it. It
carries the full swap-id preimage (`hops`, `amountOutMin`, `nonce`,
`deadline`), so a wallet-path id is computable with `deriveMultiHopSwapId`
once the blinded address is known.

- **swapId** — `string | undefined`. The swap id (the transition's first
  public output). Present immediately on the local path.
- **blindingFactor** — `string | undefined`. Claim-time ownership secret,
  local path only. Treat like a key.
- **blindedAddress** — `string | undefined`. The single-use public address
  the swap recorded.
- **tokenInId / tokenOutId** — `string`. The route's input and final output
  token ids.
- **poolKeys** — `string[]`. The route's pool keys, hop order.
- **hops** — `SwapHopInput[]`. The resolved hops (direction + price bound).
- **amountIn / amountOutMin** — `bigint`. Raw atomic amounts (u128).
- **nonce** — `bigint`. The submitted u64 nonce.
- **deadline** — `number`. The submitted block height (u32) — part of the
  multi-hop id preimage, unlike single-hop.
- **transactionId** — `string`. The request transaction's id.
- **program** — `string`. The shield_swap program targeted.

## Parameters

### poolKeys

- **Type:** `string[]`

The 2–3 pool keys (field literals) in route order. Get routes from the DEX
API's `/route`.

### tokenInId

- **Type:** `string`

Token id (field literal) being sold. Must be in the first pool.

### amountIn

- **Type:** `bigint`

Raw atomic amount to sell (u128). Must respect the input token's no-dust
rule.

### slippageBps (optional)

- **Type:** `number`
- **Default:** `50` (0.5%)

Slippage tolerance in basis points, applied once to the route's expected
final output.

### expectedOut (optional)

- **Type:** `bigint`

Quoted final output. Without it a chained spot estimate is used, which
ignores price impact and fees on every hop — pass a real quote for anything
beyond a tiny trade.

### sqrtPriceLimits (optional)

- **Type:** `bigint[]`
- **Default:** each hop's directional extreme

Explicit per-hop Q64 price bounds, one entry per hop. Each bound must lie
strictly beyond the hop's current price in the trade direction — the client
rejects a bound the finalize would revert on.

### deadlineOffsetBlocks (optional)

- **Type:** `number`
- **Default:** `100`

Blocks until the request expires.

### nonce (optional)

- **Type:** `bigint`
- **Default:** crypto-random

Explicit u64 nonce — override only for reproducible ids (e.g. tests).

### tokenInProgram (optional)

- **Type:** `string`

Program holding the caller's input-token records. Required on the
local-signer path unless `tokenRecord` is given.

### tokenRecord (optional)

- **Type:** `string | InputRequest`

Explicit record input: a plaintext literal (local signers) or a `record`
InputRequest (wallet signers). REQUIRED for wallet accounts.

### blindedIdentity (optional)

- **Type:** `{ blindingFactor: string; blindedAddress: string }`

Explicit pre-derived identity literals. Defaults to deriving from the local
account's view key, or wallet-side `derived` requests for wallet accounts.

### imports (optional)

- **Type:** `Record<string, string>`

Program sources for the dynamic-dispatch token callees — pass every token
program the route touches when proving locally.

### program (optional)

- **Type:** `string`
- **Default:** `shield_swap_v3.aleo`

shield_swap program override.
