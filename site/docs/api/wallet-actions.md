---
sidebar_position: 2
---

# Wallet Actions

Actions available on the wallet client. Require a connected wallet or local account.

## writeContract

Executes a program function.

```ts
const txId = await walletClient.writeContract({
  program: 'my_program.aleo',
  function: 'my_function',
  inputs: ['aleo1...', '100u64'],
  fee: 500_000n, // optional
})
```

**Parameters:** `{ program: string; function: string; inputs: string[]; fee?: bigint; privateFee?: boolean }`
**Returns:** `string` (transaction ID)

## transfer

Transfers credits between addresses.

```ts
const txId = await walletClient.transfer({
  to: 'aleo1...',
  amount: 1_000_000n,
  visibility: 'public', // 'public' | 'private' | 'shield' | 'unshield'
})
```

**Parameters:** `{ to: string; amount: bigint; visibility?: TransferVisibility; asset?: string }`
**Returns:** `string`

## deployContract

Deploys a program to the network.

```ts
const txId = await walletClient.deployContract({
  program: programSource,
})
```

**Parameters:** `{ program: string; fee?: bigint }`
**Returns:** `string`

## requestRecords

Fetches records owned by the connected account for a program.

```ts
const records = await walletClient.requestRecords({
  program: 'loyalty_token.aleo',
})
```

**Parameters:** `{ program: string }`
**Returns:** `unknown[]` (record objects from the wallet)

## transactionStatus

Checks the status of a submitted transaction.

```ts
const status = await walletClient.transactionStatus({
  transactionId: txId,
})
// { status: 'Accepted', transactionId: 'at1...' }
```

**Parameters:** `{ transactionId: string }`
**Returns:** `unknown`

## signMessage

Signs an arbitrary message.

```ts
const signature = await walletClient.signMessage({
  message: new Uint8Array([1, 2, 3]),
})
```

**Parameters:** `{ message: Uint8Array }`
**Returns:** `Uint8Array`

## decrypt

Decrypts a record ciphertext.

```ts
const plaintext = await walletClient.decrypt({
  ciphertext: 'record1...',
})
```

**Parameters:** `{ ciphertext: string; tpk?: string; programId?: string; functionName?: string }`
**Returns:** `string`

## sendTransaction

Broadcasts a raw transaction.

```ts
const txId = await walletClient.sendTransaction({
  transaction: jsonString,
})
```

**Parameters:** `{ transaction: string }`
**Returns:** `string`
