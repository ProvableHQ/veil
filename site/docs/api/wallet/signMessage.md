# signMessage

Signs an arbitrary message with the client's account.

Use for off-chain proof of address ownership — login challenges,
attestations. Creates no transaction and costs no fee.

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
    proverUrl: 'https://api.provable.com/prove/testnet',
    account,
  }),
})

const signature = await client.signMessage({
  message: new TextEncoder().encode('login:2026-07-01'),
})
```

## Account type differences

A local SDK account signs in process with the private key and never touches
the network. A wallet-adapter (RPC) account delegates the signature to the
connected wallet, which prompts the user.

## Returns

`Uint8Array`

Signature bytes over `message`, verifiable against the account's address.

## Parameters

### message

- **Type:** `Uint8Array`

Raw bytes to sign. The caller encodes strings itself, e.g. `new
TextEncoder().encode(text)`.
