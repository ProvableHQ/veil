---
sidebar_position: 11
---

# createDevnodeClient

Creates a fully-wired `publicClient`/`walletClient`/`account` triple pointing
at a local Aleo Devnode instance — a lightweight local Aleo node (similar to
Foundry's Anvil) that bypasses consensus and skips ZK proof generation,
enabling rapid program iteration. Uses the statically-loaded testnet SDK
binaries, so it does not need [`loadNetwork`](./loadNetwork).

Zero-config, the returned account is the devnode's seeded, pre-funded key at
`127.0.0.1:3030`; both the key and the socket address can be overridden. The
returned wallet client's confirmation wait resolves once the devnode includes
the transaction in a block — automatic after broadcast by default, or
requiring an explicit block advance when the devnode runs with
`manualBlockCreation` (see
[`@provablehq/veil-aleo-devnode`](/packages/devnode)). Record outputs owned
by the client's account decrypt to plaintext in the result; records owned by
someone else pass through as ciphertext rather than being dropped, so
positional consumers such as generated contract bindings keep every
transition's output slots intact.

## Usage

```ts
import { createDevnodeClient } from '@provablehq/veil-aleo-sdk'

// Zero-config — uses the seeded key and localhost:3030
const { publicClient, walletClient, account } = createDevnodeClient()

const txId = await walletClient.writeContract({
  program: 'credits.aleo',
  function: 'transfer_public',
  inputs: ['aleo1recipient...', '1000000u64'],
})
```

Custom key or socket address:

```ts
const { publicClient, walletClient, account } = createDevnodeClient({
  privateKey: 'APrivateKey1...',
  socketAddr: '127.0.0.1:4040',
})
```

## Returns

`{ publicClient: PublicClient; walletClient: WalletClient; account: LocalAccount<'privateKey'> }`

`publicClient` and `walletClient` share a transport bound to the devnode's
socket address. `account` is the `LocalAccount` derived from `privateKey`
(the seeded devnode key by default), wired as the wallet client's signer.
Priority fees are always 0 on this path — a fee passed to `writeContract` is
ignored.

## Parameters

### privateKey

- **Type:** `string`
- **Optional**
- **Default:** the devnode's seeded, pre-funded private key

Private key the returned account and wallet client sign with.

### socketAddr

- **Type:** `string`
- **Optional**
- **Default:** `'127.0.0.1:3030'`

Socket address (`host:port`) of the running devnode instance.
