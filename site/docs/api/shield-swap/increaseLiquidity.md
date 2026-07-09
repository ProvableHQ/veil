---
sidebar_position: 4
---

# increaseLiquidity

Adds liquidity to an existing position, privately.

Consumes the PositionNFT record plus two token records and re-issues them
(updated NFT, change records) via `increase_liquidity` on
`shield_swap_v3.aleo`. The position's tick range is fixed at mint —
`increaseLiquidity` only deepens it. Hits the network for a pool read,
record scans, hint reads, and the transaction; signs, and on the local path
proves locally.

Signer paths mirror [`mint`](/api/shield-swap/mint): a local account
auto-selects the position and both token records; a wallet account must
supply all three record inputs explicitly.

## Usage

### Local account

Auto-selects the position NFT by `poolKey` and both token records.

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

const { positionTokenId } = await client.increaseLiquidity({
  poolKey,
  amount0Desired: 10n ** 17n,
  amount1Desired: 200_000n,
  token0Program: 'ethx_5a095e.aleo',
  token1Program: 'usdc_5a095e.aleo',
})
// { positionTokenId: '789…field', transactionId: 'at1…' }
```

### Wallet account

Supply the position and both token records as `record` `InputRequest`s. The
position NFT is a record of the shield_swap program itself.

```ts
await client.increaseLiquidity({
  poolKey,
  amount0Desired: 10n ** 17n,
  amount1Desired: 200_000n,
  positionRecord: {
    type: 'record',
    program: 'shield_swap_v3.aleo',
    recordname: 'PositionNFT',
    filters: { pool: { eq: poolKey } },
  },
  token0Record: {
    type: 'record',
    program: token0Program,
    recordname: 'Token',
    filters: { amount: { gte: '100000000000000000u128' } },
  },
  token1Record: {
    type: 'record',
    program: token1Program,
    recordname: 'Token',
    filters: { amount: { gte: '200000u128' } },
  },
  tickLowerHint,
  tickUpperHint,
})
// { positionTokenId: undefined, transactionId: 'at1…' }
```

## Returns

`Promise<IncreaseLiquidityReturnType>`

- **positionTokenId** — `string | undefined`. The grown position's
  `token_id`. Known on the local path's first public output; `undefined` on
  the wallet path until confirmation.
- **transactionId** — `string`. The transaction's id.

## Parameters

### poolKey

- **Type:** `string`

Pool the position belongs to.

### amount0Desired

- **Type:** `bigint`

Raw atomic token0 to add (u128).

### amount1Desired

- **Type:** `bigint`

Raw atomic token1 to add (u128).

### amount0Min

- **Type:** `bigint`
- **Default:** `0n`

Minimum token0 actually taken.

### amount1Min

- **Type:** `bigint`
- **Default:** `0n`

Minimum token1 actually taken.

### positionTokenId

- **Type:** `string`

Which position to grow, by `token_id`. Optional on the local path — the
first unspent position for the pool is used; ignored when `positionRecord`
is given.

### positionRecord

- **Type:** `string | InputRequest`

Explicit PositionNFT record input: a plaintext literal for a local signer,
or a `record` `InputRequest` for a wallet signer. REQUIRED for wallets,
along with both token records.

### token0Program

- **Type:** `string`

Program holding token0 records, for local-path auto-select.

### token1Program

- **Type:** `string`

Program holding token1 records, for local-path auto-select.

### token0Record

- **Type:** `string | InputRequest`

Explicit token0 record input.

### token1Record

- **Type:** `string | InputRequest`

Explicit token1 record input.

### tickLowerHint

- **Type:** `number`
- **Default:** picked automatically for the position's own lower bound.

Explicit hint override.

### tickUpperHint

- **Type:** `number`
- **Default:** picked automatically for the position's own upper bound.

Explicit hint override.

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

Throws when the pool or position is missing; when records are missing
(local) or not provided (wallet); and on transport or proving errors. A
wallet account must also provide `tickLowerHint`/`tickUpperHint` explicitly —
the position's bounds are not visible wallet-side.
