# transfer

Transfers an asset to a recipient, selecting the transfer function from a
visibility mode.

A thin wrapper over [`writeContract`](/api/wallet/writeContract) that maps
`visibility` to the target program's `transfer_*` function, so it carries the
same side effects: signs, proves, and broadcasts. Returns once the
transaction is submitted — it does not wait for acceptance; poll
[`transactionStatus`](/api/wallet/transactionStatus) for that. `private` and
`unshield` transfers spend a private record, so the fee is paid privately too.

Assumes the `credits.aleo` `(recipient, amount)` transfer shape. Token
programs that share this shape but take wider amounts set
`amountWidth: 'u128'`; compliance programs that additionally require a Merkle
proof on the private side pass `merkleProof`. For a program whose function
names or input shapes differ — token_registry.aleo's public transfers, for
example, take a leading `token_id` field — call `writeContract` directly.

## Usage

```ts
import { createWalletClient, http } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const account = aleo.privateKeyToAccount('APrivateKey1...')

const client = createWalletClient({
  account,
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
  proving: aleo.createProvingConfig({
    mode: 'delegated',
    networkUrl: 'https://api.provable.com/v2',
    account,
  }),
})

const txId = await client.transfer({
  to: 'aleo1...',
  amount: 1_000_000n, // 1 credit
  visibility: 'private',
})
// 'at1...'
```

## Visibility modes

| `visibility` | Function called | Direction |
| --- | --- | --- |
| `public` (default) | `transfer_public` | public to public |
| `private` | `transfer_private` | private to private |
| `shield` | `transfer_public_to_private` | public to private |
| `unshield` | `transfer_private_to_public` | private to public |

## Returns

`string`

The transaction id (`at1...`) of the broadcast transfer.

## Parameters

### to

- **Type:** `string`

Recipient address (`aleo1...`).

### amount

- **Type:** `bigint`

Amount in the asset's base units — microcredits for `credits.aleo` — as an
atomic integer.

### visibility

- **Type:** `'public' | 'private' | 'shield' | 'unshield'`
- **Default:** `'public'`

Which side of the transfer is private; see the visibility modes above.

### asset

- **Type:** `string`
- **Default:** `'credits.aleo'`

Program to transfer from.

### amountWidth

- **Type:** `'u64' | 'u128'`
- **Default:** `'u64'`

Integer width the program's `transfer_*` functions take the amount as.
`credits.aleo` takes `u64`; ARC-20-style token programs (token_registry.aleo
and the compliance stablecoins) take `u128`. The caller supplies this — core
does not keep a program list.

### merkleProof

- **Type:** `string`

Compliance proof appended as the final input on `private`/`unshield`
transfers, for programs whose transfer functions require one (e.g.
usdcx_stablecoin.aleo, usad_stablecoin.aleo take a `[MerkleProof; 2u32]`).
Pass it pre-formatted as a single Aleo input string. Ignored for
`public`/`shield` visibility, where those programs take no proof.
