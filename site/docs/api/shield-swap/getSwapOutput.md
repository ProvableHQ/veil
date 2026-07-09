---
sidebar_position: 11
---

# getSwapOutput

Reads a computed swap result from the on-chain `swap_outputs` mapping.

Between the two phases of a private swap the chain computes the outcome and
stores it here: `amount_out` and `amount_remaining` (both u128 `bigint`) are
the values [`claimSwapOutput`](/api/shield-swap/claimSwapOutput) MUST be
called with. Read them from chain — never from an off-chain service —
because they gate money movement. Needs only a transport — no key, proving,
or scanner. Hits the network for one node request via the client's
transport.

`null` has two meanings the caller must distinguish by context: the request
transaction has not finalized yet (retry), or the output was already
claimed — a claim consumes the entry.

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
}).extend(shieldSwapActions())

const out = await client.getSwapOutput({ swapId: handle.swapId! })
if (out) {
  const { amountOut } = await client.claimSwapOutput({ handle })
}
// { recipient: 'aleo1…', caller: 'aleo1…', token_in: '1223…field',
//   token_out: '4487…field', amount_out: 987654321000000000n,
//   amount_remaining: 0n, token_in_1: '0field', amount_remaining_1: 0n,
//   token_in_2: '0field', amount_remaining_2: 0n }
```

## Returns

`Promise<SwapOutput | null>`

The decoded swap output, or `null` when the swap id is not in the mapping —
either not yet finalized, or already claimed.

- **recipient** — `string`. Address the output records are issued to.
- **caller** — `string`. Address that submitted the swap request.
- **token_in** — `string`. Token id (field literal) sold.
- **token_out** — `string`. Token id (field literal) bought.
- **amount_out** — `bigint`. Raw atomic amount received (u128), as computed
  on chain.
- **amount_remaining** — `bigint`. Raw atomic input refund (u128), non-zero
  when the swap partially filled at the price limit.
- **token_in_1** — `string`. Second input token id for a multi-hop swap
  leg; `0field` when unused.
- **amount_remaining_1** — `bigint`. Refund for `token_in_1` (u128).
- **token_in_2** — `string`. Third input token id for a multi-hop swap leg;
  `0field` when unused.
- **amount_remaining_2** — `bigint`. Refund for `token_in_2` (u128).

## Parameters

### swapId

- **Type:** `string`

Swap id as an Aleo field literal, returned by
[`swap`](/api/shield-swap/swap) as its first output, including the `field`
suffix.

### program

- **Type:** `string`
- **Default:** `shield_swap_v3.aleo`

Program to read from.

## Errors

Throws a transport error when the node is unreachable or rejects the
request, and a decode error when the value does not parse as a
`SwapOutput`.
