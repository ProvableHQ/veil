# executeContract

Executes a program function end-to-end and returns its per-transition
outputs.

Builds, proves, broadcasts, waits for confirmation, and walks the confirmed
transaction's transitions, so it hits the network, costs a fee, and does not
resolve until the transaction is accepted (or rejected). Use
[`writeContract`](/api/wallet/writeContract) when the transaction id alone is
enough, or [`simulateContract`](/api/wallet/simulateContract) to see outputs
without broadcasting.

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

const { transactionId, outputs } = await client.executeContract({
  program: 'token.aleo',
  function: 'mint_private',
  inputs: ['aleo1...', '500u64'],
})
```

## Account type differences

A local SDK account proves (locally or through a delegated prover), broadcasts,
waits for confirmation, and decrypts any owned-record outputs with the
account's own view key before returning them.

A wallet-adapter (RPC) account submits and proves through the connected
wallet; the SDK then polls the chain for confirmation and walks the
transitions itself. The SDK never asks the wallet to decrypt — record outputs
from an RPC account surface as raw `record1...` ciphertexts rather than
plaintext, since decryption crosses a permission boundary the caller should
not reach past. Plaintext outputs surface verbatim either way.

The RPC path requires a transport that can also reach the chain directly
(an HTTP transport, or a fallback that includes one) — a wallet-only
transport times out waiting for confirmation.

`inputs` may contain `record` and `address` InputRequests only on the
wallet-adapter path; the local-proving path accepts only Aleo-encoded literal
strings.

## Returns

`{ transactionId: string; transitions: RawTransitionResult[]; outputs: string[] }`

`transactionId` is the accepted transaction's id (`at1...`). `outputs` holds
the outputs of the called function's own transition; `transitions` carries
every transition the call produced, including inner cross-program calls, each
tagged with its program and function name.

## Parameters

### program

- **Type:** `string`

Program id, e.g. `token.aleo`.

### function

- **Type:** `string`

Function or transition name to invoke within `program`.

### inputs

- **Type:** `(string | InputRequest)[]`

Function inputs: Aleo-encoded literal strings, or InputRequest objects a
wallet-adapter account fulfills.

### fee

- **Type:** `bigint`
- **Default:** `0n`

Priority fee in microcredits (1 credit = 1,000,000 microcredits). Applies only
to the local-proving path; a wallet-adapter account sets its own fee.

### privateFee

- **Type:** `boolean`
- **Default:** `false`

Pays the fee from a private record instead of the public credits balance. The
fee record is resolved through the client's record provider.

### programSource

- **Type:** `string`

Program source to prove against instead of fetching it from the chain.
Local-proving path only.

### imports

- **Type:** `Record<string, string>`

Program id to source, for programs reached through dynamic dispatch that
cannot be discovered statically. Static imports are auto-discovered. On the
wallet-adapter path only the ids are forwarded — the wallet resolves the
sources itself.
