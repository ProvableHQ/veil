---
sidebar_position: 7
---

# burn

Closes a fully-drained position by consuming its PositionNFT.

The contract requires the position hold zero liquidity and zero
`tokens_owed` before `burn` on `shield_swap_v3.aleo` will accept it, so call
[`decreaseLiquidity`](/api/shield-swap/decreaseLiquidity) to zero the
liquidity and [`collect`](/api/shield-swap/collect) to sweep any owed tokens
first. The PositionNFT record is consumed and not re-issued. Hits the
network for a record scan (local path) and the transaction; signs, and on
the local path proves locally.

Signer paths mirror
[`decreaseLiquidity`](/api/shield-swap/decreaseLiquidity): a local account
auto-selects the position record; a wallet account must supply
`positionRecord`.

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

const { positionTokenId } = await client.burn({ poolKey, positionTokenId })
// { positionTokenId: '789…field', transactionId: 'at1…' }
```

### Wallet account

```ts
await client.burn({
  poolKey,
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

`Promise<BurnReturnType>`

- **positionTokenId** — `string | undefined`. The burned position's
  `token_id`, the local path's first public output; `undefined` on the
  wallet path until confirmation.
- **transactionId** — `string`. The transaction's id.

## Parameters

### poolKey

- **Type:** `string`

Pool the position belongs to. Used to locate the PositionNFT on the local
path.

### positionTokenId

- **Type:** `string`

Which position to burn, by `token_id`. Optional on the local path — the
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
`positionRecord` is missing (wallet path); when the position is not fully
drained, enforced on chain; and on transport or proving errors.
