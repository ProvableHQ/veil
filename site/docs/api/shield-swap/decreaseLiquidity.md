---
sidebar_position: 5
---

# decreaseLiquidity

Removes liquidity from a position without moving any tokens.

Consumes the PositionNFT record and re-issues it with reduced liquidity via
`decrease_liquidity` on `shield_swap_v3.aleo`. The withdrawn principal and
any accrued fees settle into the position's `tokens_owed`; a later
[`collect`](/api/shield-swap/collect) turns that owed balance into token
records. No `IARC20` transfer happens here, so no `imports` are needed. Hits
the network for a record scan (local path) and the transaction; signs, and
on the local path proves locally.

Signer paths mirror [`increaseLiquidity`](/api/shield-swap/increaseLiquidity):
a local account auto-selects the position record; a wallet account must
supply `positionRecord`.

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

const { positionTokenId } = await client.decreaseLiquidity({
  poolKey,
  liquidityToRemove: 500_000n,
})
// { positionTokenId: '789…field', transactionId: 'at1…' }
```

### Wallet account

```ts
await client.decreaseLiquidity({
  poolKey,
  liquidityToRemove: 500_000n,
  positionRecord: {
    type: 'record',
    program: 'shield_swap_v3.aleo',
    recordname: 'PositionNFT',
    filters: { pool: { eq: poolKey } },
  },
})
// { positionTokenId: undefined, transactionId: 'at1…' }
```

## Returns

`Promise<DecreaseLiquidityReturnType>`

- **positionTokenId** — `string | undefined`. The shrunk position's
  `token_id`, the local path's first public output; `undefined` on the
  wallet path until confirmation.
- **transactionId** — `string`. The transaction's id.

## Parameters

### poolKey

- **Type:** `string`

Pool the position belongs to. Used to locate the PositionNFT on the local
path.

### liquidityToRemove

- **Type:** `bigint`

Raw liquidity units to withdraw from the position (u128). Must not exceed
the position's current liquidity.

### amount0Min

- **Type:** `bigint`
- **Default:** `0n`

Minimum token0 credited to `tokens_owed` (slippage guard, raw atomic u128).

### amount1Min

- **Type:** `bigint`
- **Default:** `0n`

Minimum token1 credited to `tokens_owed`.

### positionTokenId

- **Type:** `string`

Which position to shrink, by `token_id`. Optional on the local path — the
first unspent position for the pool is used; ignored when `positionRecord`
is given.

### positionRecord

- **Type:** `string | InputRequest`

Explicit PositionNFT record input: a plaintext literal for a local signer,
or a `record` `InputRequest` for a wallet signer. REQUIRED for wallets.

### program

- **Type:** `string`
- **Default:** `shield_swap_v3.aleo`

shield_swap program override.

## Errors

Throws when no matching position is found (local path); when
`positionRecord` is missing (wallet path); and on transport or proving
errors.
