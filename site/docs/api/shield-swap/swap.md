---
sidebar_position: 1
---

# swap

Requests a private swap — phase one of the two-transaction swap lifecycle.

Resolves the trade intent against live pool state, obtains a single-use
blinded identity and a token record, and submits the `swap` transition on
`shield_swap_v3.aleo`. The chain computes the actual output at finalize; read
it back with [`getSwapOutput`](/api/shield-swap/getSwapOutput) and collect it
with [`claimSwapOutput`](/api/shield-swap/claimSwapOutput). The action hits
the network for pool reads, a deadline read, a record scan, and the
transaction itself; it signs, and on the local-signer path proves locally.

The call resolves differently by signer:

- **Local account** — derives the blinding identity from the account's view
  key, selects an unspent token record via the client's record provider,
  proves locally, and returns a handle already carrying `swapId` and
  `blindedAddress`.
- **Wallet account** — emits wallet-derived requests for the blinding slots
  (`tokenRecord` MUST be supplied); the wallet proves and returns a
  transaction id. `swapId` and `blindedAddress` become recoverable only once
  the transaction confirms.

## Usage

### Local account

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

const handle = await client.swap({
  poolKey,
  tokenInId,
  amountIn: 10n ** 18n,           // raw atomic amount, bigint
  expectedOut,                    // a real quote, scaled to raw base units
  slippageBps: 50,                // 0.5%
  tokenInProgram: 'ethx_5a095e.aleo',
})
// { swapId: '123…field', blindingFactor: '456…field', blindedAddress: 'aleo1…',
//   tokenInId, tokenOutId, poolKey, amountIn: 1000000000000000000n,
//   transactionId: 'at1…', program: 'shield_swap_v3.aleo' }
```

### Wallet account

A wallet never exposes its records, so `tokenInProgram` is dropped in favor
of a `record` `InputRequest`; the wallet resolves it against its own records
and fills the blinding slots itself. The returned handle comes back
**without** `swapId` or `blindedAddress` — recover them from the confirmed
transaction before claiming.

```ts
import { createWalletClient } from '@provablehq/veil-core'
import { fromWalletAdapter } from '@provablehq/veil-aleo-wallet-adapter'
import { shieldSwapActions, SHIELD_SWAP_ALGORITHM_GRANTS } from '@provablehq/shield-swap-sdk'

await adapter.connect(network, decryptPermission, {
  algorithmsAllowed: SHIELD_SWAP_ALGORITHM_GRANTS,
})
const { account, transport } = fromWalletAdapter(adapter)
const client = createWalletClient({ account, transport }).extend(shieldSwapActions())

const handle = await client.swap({
  poolKey,
  tokenInId,
  amountIn: 10n ** 18n,
  expectedOut,
  slippageBps: 50,
  tokenRecord: {
    type: 'record',
    program: tokenInProgram,
    recordname: 'Token',
    filters: { amount: { gte: '1000000000000000000u128' } },
  },
})
// { swapId: undefined, blindedAddress: undefined, tokenInId, tokenOutId,
//   poolKey, amountIn: 1000000000000000000n, transactionId: 'at1…',
//   program: 'shield_swap_v3.aleo' }
```

## Returns

`Promise<SwapHandle>`

The serializable thread between the swap's two transactions. Persist it —
`claimSwapOutput` consumes it, and it survives a crash or a move to another
process since it is plain JSON.

- **swapId** — `string | undefined`. Swap id field literal, the request
  transition's first output. Set immediately on the local path; on the
  wallet path, resolve it from the confirmed transaction before claiming.
- **blindingFactor** — `string | undefined`. Secret field literal proving
  ownership at claim time. Set only on the local path — a wallet keeps it
  private and re-derives it from `blindedAddress` at claim time. Treat it
  like a key.
- **blindedAddress** — `string | undefined`. The public single-use address
  the swap recorded. Set immediately on the local path; on the wallet path,
  recover it post-confirmation from the transition's public inputs or the
  API's `swap.recipient`.
- **tokenInId** — `string`. Token id (field literal) that was sold.
- **tokenOutId** — `string`. Token id (field literal) that was bought.
- **poolKey** — `string`. The pool the swap executed against.
- **amountIn** — `bigint`. Raw atomic amount sold (u128).
- **transactionId** — `string`. The request transaction's id.
- **program** — `string`. The shield_swap program the swap targets.

## Parameters

### poolKey

- **Type:** `string`

Pool key field literal to trade against.

### tokenInId

- **Type:** `string`

Token id (field literal) being sold. Must be one of the pool's two tokens.

### amountIn

- **Type:** `bigint`

Raw atomic amount to sell (u128). Must respect the token's no-dust rule.

### slippageBps

- **Type:** `number`
- **Default:** `50` (0.5%)

Slippage tolerance in basis points.

### expectedOut

- **Type:** `bigint`

Quoted output amount, e.g. from the DEX API's `/route` endpoint. Without it a
spot estimate is used, which ignores price impact and fees — pass a real
quote for anything beyond a tiny trade.

### sqrtPriceLimit

- **Type:** `bigint`
- **Default:** the directional extreme, relying on `amount_out_min` for
  slippage protection.

Explicit Q64 price bound.

### deadlineOffsetBlocks

- **Type:** `number`
- **Default:** `100`

Blocks until the swap request expires.

### nonce

- **Type:** `bigint`
- **Default:** crypto-random.

Explicit u64 nonce. Override only for reproducible ids, such as tests.

### tokenInProgram

- **Type:** `string`

Program holding the caller's token records (a wrapper program or the
registry). Required on the local-signer path unless `tokenRecord` is given;
unused when `tokenRecord` is provided.

### tokenRecord

- **Type:** `string | InputRequest`

Explicit record input: a record plaintext literal for a local signer, or a
`record` `InputRequest` for a wallet signer. REQUIRED for wallet accounts —
the client cannot guess a wallet's record shape.

### blindedIdentity

- **Type:** `{ blindingFactor: string; blindedAddress: string }`
- **Default:** derived from the local account's view key, or wallet-side
  `derived` requests for wallet accounts.

Explicit pre-derived identity literals, for a local signer that derives by
its own means.

### imports

- **Type:** `Record<string, string>`

Program sources for dynamic-dispatch dependencies (`{ 'token.aleo': source
}`). The prover cannot discover `IARC20@(...)` callees statically, so the
involved token programs' sources must be passed when proving locally or via
a service that requires them.

### program

- **Type:** `string`
- **Default:** `shield_swap_v3.aleo`

shield_swap program override.

## Errors

Throws when the pool does not exist; when the intent violates the contract's
rules (dust, bad slippage, a foreign token); when no record covers the
amount; when a wallet account is used without `tokenRecord`; and on
transport or proving errors.
