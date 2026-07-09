---
sidebar_position: 8
---

# createPool

Creates a pool for a token pair at a fee tier.

Validates the fee tier and resolves its canonical tick spacing on chain
before submitting `create_pool` on `shield_swap_v3.aleo` — an unregistered
fee or a wrong spacing is a guaranteed-revert transaction. All `create_pool`
inputs are public, so both signer paths submit the same literals. Hits the
network for two validation reads plus the transaction; signs, and on the
local path proves locally.

## Usage

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

const { poolKey } = await client.createPool({
  token0ProgramId,
  token1ProgramId,
  fee: 3000,        // pips: 0.30%
  initialTick: 0,   // sets the opening price
})
// { poolKey: '4719…field', transactionId: 'at1…' }
```

## Returns

`Promise<CreatePoolReturnType>`

- **poolKey** — `string | undefined`. The pool key field literal, the
  transition's first public output — the key every read and swap uses.
  Known immediately on the local path; `undefined` on the wallet path until
  the transaction confirms.
- **transactionId** — `string`. The create transaction's id.

## Parameters

### token0ProgramId

- **Type:** `string`

Token id (field literal) of the pair's first token. The contract sorts the
pair internally, so order does not matter.

### token1ProgramId

- **Type:** `string`

Token id (field literal) of the pair's second token.

### fee

- **Type:** `number`

Fee tier in pips, a u16 (`3000` = 0.30%). Must be registered with the
program — validated before submission.

### initialTick

- **Type:** `number`

Tick whose price the pool opens at (i32). The initial sqrt price is derived
from it via the contract's own table.

### initialSqrtPrice

- **Type:** `bigint`
- **Default:** the sqrt price at `initialTick`.

Explicit Q64 initial sqrt price. Override only to reproduce an exact
historical price.

### tickSpacing

- **Type:** `number`
- **Default:** the canonical spacing bound to `fee` on chain.

Explicit tick spacing. Overriding it is almost never correct.

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

Throws when the fee tier is unregistered or has no bound tick spacing; when
`initialTick` is out of range; and on transport or proving errors.
