---
sidebar_position: 3
---

# mint

Mints a new concentrated-liquidity position as a private PositionNFT.

Deposits both tokens privately (records in, change back), aligns the tick
range to the pool's tick spacing, computes insert hints, and submits `mint`
on `shield_swap_v3.aleo`. The PositionNFT record the transition returns is
the key to every later liquidity operation on the position — the account's
record scanner picks it up. Hits the network for pool and slot reads, hint
reads, record scans, and the transaction; signs, and on the local path
proves locally.

Signer paths mirror [`swap`](/api/shield-swap/swap): a local account
auto-selects both token records and passes literals; a wallet account must
supply both token records as `record` `InputRequest`s and gets the recipient
defaulted to its own address.

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

const slot = await client.getSlot({ poolKey })

const { positionTokenId } = await client.mint({
  poolKey,
  tickLower: slot.tick - slot.tick_spacing * 10,
  tickUpper: slot.tick + slot.tick_spacing * 10,
  amount0Desired: 10n ** 18n,
  amount1Desired: 2_000_000n,
  token0Program: 'ethx_5a095e.aleo',
  token1Program: 'usdc_5a095e.aleo',
})
// { positionTokenId: '789…field', transactionId: 'at1…' }
```

### Wallet account

Drop the two `*Program` fields and pass `token0Record`/`token1Record` as
`record` `InputRequest`s; the wallet resolves each against its own records.

```ts
const { positionTokenId } = await client.mint({
  poolKey,
  tickLower: slot.tick - slot.tick_spacing * 10,
  tickUpper: slot.tick + slot.tick_spacing * 10,
  amount0Desired: 10n ** 18n,
  amount1Desired: 2_000_000n,
  token0Record: {
    type: 'record',
    program: token0Program,
    recordname: 'Token',
    filters: { amount: { gte: '1000000000000000000u128' } },
  },
  token1Record: {
    type: 'record',
    program: token1Program,
    recordname: 'Token',
    filters: { amount: { gte: '2000000u128' } },
  },
})
// { positionTokenId: undefined, transactionId: 'at1…' }
```

## Returns

`Promise<MintReturnType>`

- **positionTokenId** — `string | undefined`. The minted position's
  `token_id` — the key for `getPosition` and later liquidity operations.
  Known immediately on the local path; `undefined` on the wallet path until
  confirmation.
- **transactionId** — `string`. The mint transaction's id.

## Parameters

### poolKey

- **Type:** `string`

Pool to provide liquidity to.

### tickLower

- **Type:** `number`

Lower bound of the range. Rounded down to the pool's tick spacing
automatically.

### tickUpper

- **Type:** `number`

Upper bound of the range. Rounded down to spacing.

### amount0Desired

- **Type:** `bigint`

Raw atomic amount of token0 to deposit (u128).

### amount1Desired

- **Type:** `bigint`

Raw atomic amount of token1 to deposit (u128).

### amount0Min

- **Type:** `bigint`
- **Default:** `0n`

Minimum token0 actually taken (slippage guard). Set it for pools with a
volatile in-range price.

### amount1Min

- **Type:** `bigint`
- **Default:** `0n`

Minimum token1 actually taken.

### recipient

- **Type:** `string`
- **Default:** the account address.

Position owner. MUST NOT be the program address.

### token0Program

- **Type:** `string`

Program holding the caller's token0 records. Required on the local path
unless `token0Record` is given.

### token1Program

- **Type:** `string`

Program holding the caller's token1 records. Required on the local path
unless `token1Record` is given.

### token0Record

- **Type:** `string | InputRequest`

Explicit token0 record input: a plaintext literal for a local signer, or a
`record` `InputRequest` for a wallet signer. REQUIRED for wallets.

### token1Record

- **Type:** `string | InputRequest`

Explicit token1 record input, matching `token0Record`'s shape.

### tickLowerHint

- **Type:** `number`
- **Default:** picked automatically via the pool's tick-hint search
  (best-effort).

Explicit insert hint for the lower tick.

### tickUpperHint

- **Type:** `number`
- **Default:** picked automatically.

Explicit insert hint for the upper tick.

### nonce

- **Type:** `string`
- **Default:** crypto-random field.

Explicit field nonce.

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

Throws when the pool does not exist; when the tick range is empty after
spacing alignment; when records are missing (local) or not provided
(wallet); and on transport or proving errors.
