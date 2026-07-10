# writeContract

Executes a program function on-chain and returns the transaction id.

The workhorse write action: use it when the transaction id is enough and the
function's outputs are not needed. Use [`executeContract`](/api/wallet/executeContract)
for outputs, [`simulateContract`](/api/wallet/simulateContract) for a dry run.
Signs, proves, and broadcasts, so it hits the network and costs a fee. Returns
as soon as the transaction is submitted — it does not wait for acceptance;
poll [`transactionStatus`](/api/wallet/transactionStatus) for the outcome.
Exported as `executeTransaction` too, matching Aleo wallet-adapter
terminology.

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

const txId = await client.writeContract({
  program: 'token.aleo',
  function: 'transfer_public',
  inputs: ['aleo1...', '100u64'],
})
// 'at1...'
```

## Account type differences

A wallet-adapter (RPC) account hands the call to the connected wallet, which
proves, signs, and broadcasts in one step and prompts the user. A local SDK
account builds and proves the transaction through the client's `proving`
config — in process for `mode: 'local'`, via a delegated prover for
`mode: 'delegated'` — then broadcasts it through the transport. Delegated mode
requires `proverUrl` on the proving config (plus `apiKey` and `consumerId` for
the hosted Provable prover); local mode needs neither. Either way the fee
comes out of the account, unless a delegated prover with `useFeeMaster`
covers it.

`inputs` may contain `record` and `address` InputRequests only on the
wallet-adapter path — the wallet resolves them without exposing private data
to the caller. The local-proving path only accepts Aleo-encoded literal
strings and throws if it sees an InputRequest; supply record inputs directly,
as described in [Working with records](/guides/working-with-records).

## Returns

`string`

The transaction id (`at1...`) of the broadcast execution.

## Parameters

### program

- **Type:** `string`

Program id, e.g. `token.aleo`.

### function

- **Type:** `string`

Function or transition name to invoke within `program`.

### inputs

- **Type:** `(string | InputRequest)[]`

Function inputs: Aleo-encoded literal strings (`'100u64'`, `'aleo1...'`), or
InputRequest objects a wallet-adapter account fulfills — see [Working with
records](/guides/working-with-records).

### privateFee

- **Type:** `boolean`
- **Default:** `false`

Pays the fee from a private record instead of the public credits balance. The
fee record is resolved through the client's record provider; the caller does
not supply one.

### imports

- **Type:** `string[]`

Names of programs reached through dynamic dispatch that the prover or wallet
cannot discover statically. Programs declared in `program`'s own `import`
block are discovered automatically and do not need listing here.
