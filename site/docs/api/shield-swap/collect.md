---
sidebar_position: 6
---

# collect

Withdraws a position's owed tokens as private records.

Turns the `tokens_owed` balance accrued by
[`decreaseLiquidity`](/api/shield-swap/decreaseLiquidity) and fee
accumulation into private token records for `recipient` via `collect` on
`shield_swap_v3.aleo`, keeping the recipient's identity off-chain. Consumes
the PositionNFT and re-issues it. Hits the network for a pool read, a record
scan (local path), and the transaction; signs, and on the local path proves
locally.

Signer paths mirror
[`increaseLiquidity`](/api/shield-swap/increaseLiquidity): a local account
auto-selects the position record and passes literals; a wallet account must
supply `positionRecord`. The recipient defaults to the account address on
both paths.

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

const { transactionId } = await client.collect({
  poolKey,
  amount0Requested: 10n ** 17n,
  amount1Requested: 200_000n,
})
// { transactionId: 'at1…' }
```

### Wallet account

```ts
await client.collect({
  poolKey,
  amount0Requested: 10n ** 17n,
  amount1Requested: 200_000n,
  positionRecord: {
    type: 'record',
    program: 'shield_swap_v3.aleo',
    recordname: 'PositionNFT',
    filters: { pool: { eq: poolKey } },
  },
})
```

## Returns

`Promise<CollectReturnType>`

- **transactionId** — `string`. The transaction's id. The withdrawn tokens
  arrive as private records for `recipient`; the account's record scanner
  picks them up.

## Parameters

### poolKey

- **Type:** `string`

Pool the position belongs to. Used to resolve the two token ids and to
locate the PositionNFT on the local path.

### amount0Requested

- **Type:** `bigint`

Raw atomic token0 to withdraw from `tokens_owed` (u128). Capped on chain at
the owed balance.

### amount1Requested

- **Type:** `bigint`

Raw atomic token1 to withdraw (u128). Capped on chain at the owed balance.

### recipient

- **Type:** `string`
- **Default:** the account address.

Address that receives the private token records. MUST NOT be the program
address.

### positionTokenId

- **Type:** `string`

Which position to collect from, by `token_id`. Optional on the local path —
the first unspent position for the pool is used; ignored when
`positionRecord` is given.

### positionRecord

- **Type:** `string | InputRequest`

Explicit PositionNFT record input: a plaintext literal for a local signer,
or a `record` `InputRequest` for a wallet signer. REQUIRED for wallets.

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

Throws when the pool does not exist; when no matching position is found
(local path); when `positionRecord` is missing (wallet path); and on
transport or proving errors.
