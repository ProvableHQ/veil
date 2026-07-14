---
sidebar_position: 2.2
---

# claimMultiHopOutput

Claims a private multi-hop swap's output — phase two of the lifecycle.

Reads the chain-computed result from `swap_outputs` (never an off-chain
service — these amounts gate money movement), proves ownership of the
blinded identity, and submits `claim_multi_hop_output`. The output and any
refunds arrive as private records owned by the signer; the mapping entry is
consumed. Hits the network for one mapping read plus the transaction; signs,
and on the local path proves locally.

Signer paths mirror
[`claimSwapOutput`](/api/shield-swap/claimSwapOutput): a local account
passes the handle's literal `blindingFactor`; a wallet account gets
resolve-mode derived requests targeting the handle's `blindedAddress` and
re-derives the factor itself.

## Usage

```ts
const { amountOut, amountRemaining, hopRefunds } = await client.claimMultiHopOutput({
  handle,      // from swapMultiHop
  imports,     // every token program the route touches — the claim can transfer up to four
})
```

If it throws `SwapOutputNotFinalizedError`, the request transaction has not
finalized yet — retry after a few blocks. The same error after a successful
claim means the output was already collected.

## Returns

`Promise<ClaimMultiHopOutputReturnType>`

- **transactionId** — `string`. The claim transaction's id.
- **amountOut** — `bigint`. Raw atomic amount of the final output token
  received (u128), as computed on chain.
- **amountRemaining** — `bigint`. Raw atomic input refund (u128) — non-zero
  when the route partially filled at a price limit.
- **hopRefunds** — `Array<{ tokenId: string; amount: bigint }>`.
  Intermediate-token refunds from partial fills on later hops, zero-amount
  padding filtered out.

## Parameters

### handle

- **Type:** `MultiHopSwapHandle`

The handle from [`swapMultiHop`](/api/shield-swap/swapMultiHop). Local-path
handles are complete; wallet-path handles need `swapId` and `blindedAddress`
resolved from the confirmed request transaction (or computed with
`deriveMultiHopSwapId`) first.

### imports (optional)

- **Type:** `Record<string, string>`

Program sources for the dynamic-dispatch token callees. The claim transfers
up to four tokens (output, input refund, two hop refunds), so pass every
involved token program's source when proving locally.

### program (optional)

- **Type:** `string`
- **Default:** the handle's program

shield_swap program override.
