# decrypt

Decrypts a ciphertext the account's view key can open.

Use it to read a record returned by an execution, or a private transition
output. `cipherText` alone decrypts a record ciphertext (`record1...`); the
four transition fields below are needed only for transition output
ciphertexts (`ciphertext1...`), which are bound to the transition that
produced them.

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

const plaintext = await client.decrypt({ cipherText: 'record1...' })
```

## Account type differences

A local SDK account holds its view key locally, so decryption runs in process
through the proving config and never touches the network. A wallet-adapter
(RPC) account sends the request to the connected wallet, which holds the view
key and may prompt the user.

## Returns

`string`

The decrypted Aleo plaintext the view key reveals — a record's fields or a
literal value.

## Parameters

### cipherText

- **Type:** `string`

Ciphertext to decrypt: a record (`record1...`) or a transition output
(`ciphertext1...`).

### tpk

- **Type:** `string`

Transition public key of the transition that produced the ciphertext.
Required for `ciphertext1...` values; omit for records.

### programId

- **Type:** `string`

Program that produced the ciphertext, e.g. `credits.aleo`. Required alongside
`tpk`.

### functionName

- **Type:** `string`

Function within `programId` that produced the ciphertext. Required alongside
`tpk`.

### index

- **Type:** `number`

Zero-based position of the ciphertext among the transition's outputs.
Required alongside `tpk`.
