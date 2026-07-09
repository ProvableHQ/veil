# switchChain

Switches the connected wallet to a different network.

Also exported as `switchNetwork`, matching Aleo wallet-adapter terminology.

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

await client.switchChain({ network: 'mainnet' })
```

## Account type differences

A wallet-adapter (RPC) account forwards the switch to the connected wallet,
which prompts the user. A local SDK account reloads the proving SDK for the
new network, re-targets the attached record provider when it supports
`switchNetwork`, and updates the transport's network routing in place — the
account itself is unaffected, since Aleo private keys, view keys, and
addresses are network-agnostic. This path requires the proving config to
expose `switchNetwork`, which `@provablehq/veil-aleo-sdk`'s
`createProvingConfig` provides.

If the record provider fails to switch, the proving stack is restored to the
previous network and the transport keeps routing there, so the client is left
fully on its old network rather than split between two.

## Returns

`void`

Resolves once the client targets the new network.

## Parameters

### network

- **Type:** `string`

Network to switch to, e.g. `'mainnet'` or `'testnet'`.
