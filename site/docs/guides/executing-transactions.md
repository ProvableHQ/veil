---
sidebar_position: 2
---

# Executing Transactions

Use the wallet client to call program functions on Aleo.

## Three Surfaces

| Action | What it returns | Use when |
|---|---|---|
| `writeContract` (alias `executeTransaction`) | The transaction id only. | You want to fire-and-poll. Matches the Aleo wallet adapter spec. |
| `executeContract` | Tx id + per-transition outputs (records decrypted for local accounts). | You want to act on the function's return value. |
| `simulateContract` | Per-transition outputs, no broadcast. **Local accounts only.** | Dry-run / preview before committing on-chain. |

## Submit-and-go (`writeContract`)

```ts
const txId = await walletClient.writeContract({
  program: 'my_program.aleo',
  function: 'my_function',
  inputs: ['aleo1...', '100u64'],
  // privateFee?: pay the fee from a private record (default: false)
  // imports?: program names reached via dynamic dispatch (static imports auto-discovered)
})
```

Priority fee is handled by the proving layer / wallet — callers don't pass a microcredit amount on `writeContract`.

## Submit and read outputs (`executeContract`)

```ts
const { transactionId, transitions, outputs } = await walletClient.executeContract({
  program: 'my_program.aleo',
  function: 'my_function',
  inputs: ['aleo1...', '100u64'],
  // fee: priority fee in microcredits (local accounts; default 0n)
  // privateFee, imports as above
})
```

For RPC accounts, record outputs surface as raw `record1...` ciphertexts (the SDK doesn't ask the wallet to decrypt). For local accounts, owned record outputs are decrypted with the account's view key.

## Dry-run (`simulateContract`)

```ts
const { transitions, outputs } = await walletClient.simulateContract({
  program: 'my_program.aleo',
  function: 'my_function',
  inputs: ['aleo1...', '100u64'],
})
```

`simulateContract` runs the function locally via the proving config's `simulate` hook and decrypts owned outputs with the account's view key. RPC (wallet) accounts cannot simulate.

## How It Works

The wallet client routes execution based on account type:

- **RPC account** (browser wallet) — delegates to the wallet extension, which handles proving and broadcasting
- **Local account** (private key) — builds the transaction locally using the proving config, then broadcasts via the transport

Your code is identical either way. The only difference is how the client was created.

## Inputs

Inputs are passed as strings in Aleo's value format:

```ts
inputs: [
  'aleo1address...',          // address
  '100u64',                    // unsigned integer
  '-5i32',                     // signed integer
  '12345field',                // field element
  'true',                      // boolean
  card.recordPlaintext,        // record (from requestRecords)
]
```

## Deployment

```ts
const txId = await walletClient.deployContract({
  program: programSource,
})
```

## Transfers

A convenience wrapper for credit transfers (and any token program that follows the same naming convention):

```ts
const txId = await walletClient.transfer({
  to: 'aleo1recipient...',
  amount: 1_000_000n,           // 1 credit
  visibility: 'public',         // 'public' | 'private' | 'shield' | 'unshield'
  // asset: defaults to 'credits.aleo'; pass a token program id to transfer that token
})
```

Visibility maps to function names:

| `visibility` | Function called |
|---|---|
| `'public'` | `transfer_public` |
| `'private'` | `transfer_private` |
| `'shield'` | `transfer_public_to_private` |
| `'unshield'` | `transfer_private_to_public` |

For programs that don't follow this convention, call `writeContract` directly.
