# getChainId

Returns the current network from the connected wallet.

The Aleo equivalent of viem's `getChainId`, but returns a network name
(`'mainnet'`, `'testnet'`) rather than a numeric chain id. A local account
reads the network configured on the transport directly; a wallet-adapter
(RPC) account asks the connected wallet. Also exported as `getNetwork`.

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

const network = await client.getChainId()
// 'testnet'
```

## Returns

`string`

The network the client's transactions target, e.g. `'mainnet'` or
`'testnet'`.
