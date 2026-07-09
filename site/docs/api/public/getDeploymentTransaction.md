# getDeploymentTransaction

Retrieves the transaction that deployed a program.

Queries the connected Aleo node, so it hits the network. Use it to find who
deployed a program and when; for a specific edition's deployment use
[`getDeploymentTransactionByEdition`](/api/public/getDeploymentTransactionByEdition).

## Usage

```ts
import { createPublicClient, http } from '@provablehq/veil-core'

const client = createPublicClient({
  transport: http('https://api.provable.com/v2', { network: 'mainnet' }),
})

const tx = await client.getDeploymentTransaction({ programId: 'token.aleo' })
// { type: 'deploy', id: 'at1...', deployment: { edition: 0, program: '...', verifying_keys: [...] }, fee: { ... }, owner: { address: 'aleo1...', signature: '...' } }
```

## Returns

`Transaction`

The deployment transaction: its `id`, a `deployment` (the program source,
edition, and verifying keys), a `fee` execution, and an `owner` carrying the
deployer's address and signature.

## Parameters

### programId

- **Type:** `string`

Program (e.g. `token.aleo`) whose deployment to find.
