---
sidebar_position: 2
---

# Executing Transactions

Use the wallet client to call program functions on Aleo.

## Basic Execution

```ts
const txId = await walletClient.writeContract({
  program: 'my_program.aleo',
  function: 'my_function',
  inputs: ['aleo1...', '100u64'],
})
```

The `fee` parameter is optional — the wallet will estimate it if omitted.

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

A convenience wrapper for credit transfers:

```ts
const txId = await walletClient.transfer({
  to: 'aleo1recipient...',
  amount: 1_000_000n,           // 1 credit
  visibility: 'public',         // 'public' | 'private' | 'shield' | 'unshield'
})
```
