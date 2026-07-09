# deployContract

Deploys an Aleo program to the network.

Publishes program source; once the deployment is accepted, the program is
callable through [`writeContract`](/api/wallet/writeContract). Signs, proves,
and broadcasts, so it hits the network and costs a fee that scales with
program size. Returns as soon as the transaction is submitted — it does not
wait for acceptance; poll [`transactionStatus`](/api/wallet/transactionStatus)
for the outcome. Imports are not exposed as a parameter — the deployer
auto-discovers them from the program source.

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

const txId = await client.deployContract({
  program: 'program hello.aleo; function main: ...',
})
// 'at1...'
```

## Account type differences

A wallet-adapter (RPC) account has the connected wallet build, prove, and
broadcast the deployment, prompting the user. A local SDK account builds and
proves through the client's `proving` config, then the transport broadcasts
it. Either way the deployment fee comes out of the account.

## Returns

`string`

The transaction id (`at1...`) of the broadcast deployment.

## Parameters

### program

- **Type:** `string`

Aleo program source (`program X.aleo; ...`).

### privateFee

- **Type:** `boolean`
- **Default:** `false`

Pays the deployment fee from a private record instead of the public credits
balance. The fee record is resolved through the client's record provider; the
caller does not supply one.
