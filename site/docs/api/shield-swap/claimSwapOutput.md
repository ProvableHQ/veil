---
sidebar_position: 2
---

# claimSwapOutput

Claims a private swap's output — phase two of the swap lifecycle.

Reads the chain-computed result from the `swap_outputs` mapping, never from
an off-chain service, because these amounts gate money movement. It then
proves ownership of the blinded identity and submits `claim_swap_output` on
`shield_swap_v3.aleo`. The output and any refund arrive as private records
owned by the signer; the mapping entry is consumed. Hits the network for one
mapping read plus the transaction; signs, and on the local path proves
locally.

Signer paths mirror [`swap`](/api/shield-swap/swap): a local account passes
the handle's literal `blindingFactor`; a wallet account gets resolve-mode
derived requests targeting the handle's `blindedAddress` and re-derives the
blinding factor itself.

## Usage

### Local account

The handle from `swap` already carries `swapId` and `blindedAddress`, so no
extra recovery step is needed before claiming.

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const aleo = await loadNetwork('testnet')
const scanner = aleo.createRemoteScanner({
  url: 'https://api.provable.com/scanner',
  consumerId: CONSUMER_ID,
  apiKey: DPS_API_KEY,
})
const { walletClient } = aleo.createAleoClient({
  privateKey: PRIVATE_KEY,
  networkUrl: 'https://api.provable.com/v2',
  provingMode: 'delegated',
  proverUrl: 'https://api.provable.com/prove/testnet',
  apiKey: DPS_API_KEY,
  consumerId: CONSUMER_ID,
  records: scanner,
})
const client = walletClient.extend(shieldSwapActions())

const { amountOut, amountRemaining } = await client.claimSwapOutput({ handle })
// { transactionId: 'at1…', amountOut: 987654321000000000n, amountRemaining: 0n }
```

### Wallet account

The wallet filled the blinding slots at request time, so the handle came
back without `swapId`/`blindedAddress`. Recover them from the confirmed
request transaction first — `swapId` is the transition's first public
output, and the blinded address is also readable from
`api.getSwap(...).recipient` — set them on the handle, then claim. The
wallet re-derives the blinding factor from the blinded address, so the dapp
never holds it.

```ts
handle.swapId = swapIdFromConfirmedTx
handle.blindedAddress = blindedAddressFromConfirmedTx

const { amountOut, amountRemaining } = await client.claimSwapOutput({ handle })
```

If claiming throws `SwapOutputNotFinalizedError`, the request transaction
has not finalized yet — retry after a few blocks. The same error after a
successful claim means the output was already collected; claiming consumes
the on-chain entry.

## Returns

`Promise<ClaimSwapOutputReturnType>`

- **transactionId** — `string`. The claim transaction's id.
- **amountOut** — `bigint`. Raw atomic amount received (u128), as computed
  on chain.
- **amountRemaining** — `bigint`. Raw atomic input refund (u128), non-zero
  when the swap partially filled at the price limit.

## Parameters

### handle

- **Type:** `SwapHandle`

The handle returned by [`swap`](/api/shield-swap/swap). Local-signer handles
are complete; wallet-path handles need `swapId` and `blindedAddress`
resolved from the confirmed request transaction first.

### imports

- **Type:** `Record<string, string>`

Program sources for dynamic-dispatch dependencies (`{ 'token.aleo': source
}`). The prover cannot discover `IARC20@(...)` callees statically, so the
involved token programs' sources must be passed when proving locally or via
a service that requires them.

### program

- **Type:** `string`
- **Default:** the handle's `program`.

shield_swap program override.

## Errors

Throws `SwapOutputNotFinalizedError` when the output is not readable yet
(the request has not finalized — retry) or was already claimed. Also throws
when the handle is missing the fields its signer path needs, and on
transport or proving errors.
