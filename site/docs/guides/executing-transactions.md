---
sidebar_position: 2
---

# Executing Transactions

Calling a program function on Aleo means building an execution transaction —
proving that the function ran correctly on the given inputs — and
broadcasting it to the network. A [wallet client](/clients/wallet-client)
carries out both steps. Unlike a public client, a wallet client is always
bound to an account, so it can sign, prove, and pay the transaction's fee.

## Two kinds of account

A wallet client works the same way regardless of where the signing key
lives, but the key can live in one of two places:

- **A connected wallet (RPC account).** Built with `fromWalletAdapter` from
  `@provablehq/veil-aleo-wallet-adapter`, or `useVeilWallet` in a React
  dApp. The wallet extension holds the private key, proves, signs, and
  broadcasts — the calling code never sees key material.
- **A local account (SDK).** The caller holds the private key directly —
  scripts, bots, servers, CI. `loadNetwork` from `@provablehq/veil-aleo-sdk`
  loads the network's proving binaries and derives the account:

```ts
import { createWalletClient, http } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const account = aleo.privateKeyToAccount('APrivateKey1...')

const walletClient = createWalletClient({
  account,
  transport: http('https://api.provable.com/v2', { network: 'testnet' }),
  proving: aleo.createProvingConfig({
    mode: 'delegated',
    networkUrl: 'https://api.provable.com/v2',
    account,
  }),
})
```

`createProvingConfig`'s `mode` selects where the proof is produced:
`'local'` builds it in-process from the SDK's WASM binaries; `'delegated'`
submits the proving work to a remote prover instead, which keeps proving off
the caller's machine at the cost of a network round trip. Either mode plugs
into the same wallet client, and every action below behaves identically
regardless of which account type backs it — the client resolves the
difference internally.

## Calling a function

[`writeContract`](/api/wallet/writeContract) executes a program function and
returns the transaction id as soon as it is broadcast — it does not wait for
the transaction to be accepted:

```ts
const txId = await walletClient.writeContract({
  program: 'token.aleo',
  function: 'transfer_public',
  inputs: ['aleo1...', '100u64'],
})
// 'at1...'
```

Use [`executeContract`](/api/wallet/executeContract) instead when the
function's outputs are needed: it waits for confirmation and returns the
parsed outputs of every transition the call produced. Use
[`simulateContract`](/api/wallet/simulateContract) to run the same call
locally with no fee and no broadcast — a dry run, available only to local
accounts.

## Inputs

Inputs are Aleo-encoded literal strings, positional and typed to match the
function's signature:

```ts
inputs: [
  'aleo1address...',   // address
  '100u64',            // unsigned integer
  '-5i32',              // signed integer
  '12345field',         // field element
  'true',               // boolean
]
```

A record consumed by the function is passed the same way, as its plaintext
string. An RPC account additionally accepts `InputRequest` objects in place
of a literal — the wallet resolves these itself rather than handing private
data back to the caller. Local accounts only accept literal strings and throw
if given an `InputRequest`. See [Working with Records](/guides/working-with-records)
for both paths in full.

## Paying the fee

By default the fee is paid from the account's public credits balance. Set
`privateFee: true` to spend a private record for it instead — the client's
record provider resolves which record to spend:

```ts
const txId = await walletClient.writeContract({
  program: 'token.aleo',
  function: 'transfer_public',
  inputs: ['aleo1...', '100u64'],
  privateFee: true,
})
```

## Deploying a program

[`deployContract`](/api/wallet/deployContract) publishes program source.
Once the deployment is accepted, the program is callable through
`writeContract` like any other:

```ts
const txId = await walletClient.deployContract({
  program: programSource,
})
```

Imports are not a parameter here — the deployer discovers them from the
program source automatically.

## Transferring credits

[`transfer`](/api/wallet/transfer) is a convenience wrapper over
`writeContract` that maps a `visibility` mode to the matching
`credits.aleo` transfer function:

```ts
const txId = await walletClient.transfer({
  to: 'aleo1recipient...',
  amount: 1_000_000n, // 1 credit = 1,000,000 microcredits
  visibility: 'private',
})
```

| `visibility` | Function called | Direction |
| --- | --- | --- |
| `public` (default) | `transfer_public` | public to public |
| `private` | `transfer_private` | private to private |
| `shield` | `transfer_public_to_private` | public to private |
| `unshield` | `transfer_private_to_public` | private to public |

For a program whose transfer shape differs from `credits.aleo`'s — a token
program with a leading `token_id` argument, for instance — call
`writeContract` directly against that program's function.

Every action here returns as soon as the network accepts the broadcast; see
[Transaction Lifecycle](/guides/transaction-lifecycle) for tracking a
transaction to acceptance and reading back the state it changed.
