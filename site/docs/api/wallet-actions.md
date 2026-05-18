---
sidebar_position: 2
---

# Wallet Actions

Actions available on the wallet client. Require a connected wallet or local account.

## writeContract

Submits a program execution. Returns only the transaction id — use `executeContract` if you need to wait for confirmation and read outputs.

```ts
const txId = await walletClient.writeContract({
  program: 'my_program.aleo',
  function: 'my_function',
  inputs: ['aleo1...', '100u64'],
})
```

**Parameters:** `{ program: string; function: string; inputs: string[]; privateFee?: boolean; imports?: string[] }`
**Returns:** `string` (transaction ID)

- `privateFee` — pay the fee from a private record. The fee record is resolved via the wallet client's `recordProvider`; callers don't supply one. Defaults to `false`.
- `imports` — names of programs reached via dynamic dispatch. Static imports declared in the program's `import` block are auto-discovered.

Exported under two names: `writeContract` (veil/viem-style) and `executeTransaction` (Aleo wallet adapter spec). They are the same function.

## simulateContract

Runs a program function locally and returns its outputs without broadcasting (Aleo's equivalent of a dry run).

```ts
const { transitions, outputs } = await walletClient.simulateContract({
  program: 'my_program.aleo',
  function: 'my_function',
  inputs: ['aleo1...', '100u64'],
})
```

**Parameters:** `{ program: string; function: string; inputs: string[]; programSource?: string; imports?: Record<string, string> }`
**Returns:** `{ transitions: RawTransitionResult[]; outputs: string[] }`

Available for local accounts only (whose `proving` config implements `simulate`). RPC accounts throw `SimulateNotSupportedError`.

## executeContract

End-to-end: builds the transaction, broadcasts it, waits for chain confirmation, and returns parsed per-transition outputs.

```ts
const { transactionId, transitions, outputs } = await walletClient.executeContract({
  program: 'my_program.aleo',
  function: 'my_function',
  inputs: ['aleo1...', '100u64'],
  fee: 0n,                     // local accounts: priority fee in microcredits (default 0n)
})
```

**Parameters:** `{ program: string; function: string; inputs: string[]; fee?: bigint; privateFee?: boolean; programSource?: string; imports?: Record<string, string> }`
**Returns:** `{ transactionId: string; transitions: RawTransitionResult[]; outputs: string[] }`

For local accounts, owned record outputs are decrypted with the account's view key. For RPC accounts, the wallet submits and the SDK polls the chain itself — record outputs surface as raw `record1...` ciphertexts because the SDK does not ask the wallet to decrypt them.

Requires a transport that can reach the chain (HTTP, or a `fallback` including one). A wallet-only transport will time out on the confirmation poll.

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

**Parameters:** `{ program: string; privateFee?: boolean }`
**Returns:** `string`

Imports are auto-discovered from the program source. As with `writeContract`, when `privateFee` is true the fee record is resolved via the wallet client's `recordProvider`.

## requestRecords

Fetches records owned by the connected account for a program.

```ts
const records = await walletClient.requestRecords({
  program: 'loyalty_token.aleo',
  statusFilter: 'unspent',
})
```

**Parameters:** `{ program: string; includePlaintext?: boolean; statusFilter?: 'all' | 'spent' | 'unspent' }`
**Returns:** `OwnedRecord[]`

**Routing by account type:**

- **RPC account** (wallet adapter) — delegates to the wallet adapter transport. No extra config.
- **Local account** (SDK) — delegates to the `recordProvider` set in wallet client config. Throws if no `recordProvider` is configured.

See [Working with Records](/guides/working-with-records) for scanner setup.

## requestTransactionHistory

Gets transaction history for a program from the wallet.

```ts
const history = await walletClient.requestTransactionHistory({
  program: 'loyalty_token.aleo',
})
```

**Parameters:** `{ program: string }`
**Returns:** `unknown`

## transactionStatus

Checks the status of a submitted transaction. RPC accounts route to the wallet adapter; local accounts (or no account) derive status from the network's REST API.

```ts
const status = await walletClient.transactionStatus({
  transactionId: txId,
})
// { status: 'accepted',  transactionId: 'at1...' }
// { status: 'rejected',  transactionId: 'at1...', error?: '...' }
// { status: 'pending',   transactionId: '...' }
// { status: 'not_found' }
```

**Parameters:** `{ transactionId: string }`
**Returns:** `TransactionStatusResponse` (`{ status: string; transactionId?: string; error?: string }`)

Possible statuses: `accepted` | `rejected` | `pending` | `not_found`.

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

## switchChain

Switches the wallet's connected network.

```ts
await walletClient.switchChain({ network: 'testnet' })
```

**Parameters:** `{ network: 'mainnet' | 'testnet' }`
**Returns:** `void`

## switchNetwork

Alias for [`switchChain`](#switchchain).

```ts
await walletClient.switchNetwork({ network: 'mainnet' })
```

**Parameters:** `{ network: 'mainnet' | 'testnet' }`
**Returns:** `void`

## getChainId

Returns the current network string from the connected wallet.

```ts
const network = await walletClient.getChainId()
// 'mainnet'
```

**Parameters:** none
**Returns:** `string`

## getNetwork

Alias for [`getChainId`](#getchainid) — matches Aleo terminology.

```ts
const network = await walletClient.getNetwork()
```

**Parameters:** none
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
