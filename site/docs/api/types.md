---
sidebar_position: 4
---

# Types

Core type definitions exported from `@provablehq/veil-core`.

## Clients

```ts
import type { Client, PublicClient, WalletClient } from '@provablehq/veil-core'
```

- **`Client`** — Base client with `account`, `transport`, `request`, `extend`
- **`PublicClient`** — `Client` extended with public actions
- **`WalletClient`** — `Client` extended with wallet actions

## Accounts

```ts
import type {
  AnyAccount,
  LocalAccount,
  RpcAccount,
  ViewOnlyAccount,
} from '@provablehq/veil-core'
```

- **`RpcAccount`** — `type: 'rpc'`. Signing delegated to wallet. Created by `fromWalletAdapter()`.
- **`LocalAccount`** — `type: 'local'`. Has `privateKey`, `viewKey`. Created by `privateKeyToAccount()`.
- **`ViewOnlyAccount`** — `type: 'viewOnly'`. Has `viewKey`, cannot sign.

## Transport

```ts
import type { Transport } from '@provablehq/veil-core'
```

## Wallet Adapter

```ts
import type {
  AleoWalletAdapter,    // minimal interface for custom adapters
  AnyWalletAdapter,     // union of AleoWalletAdapter | BaseAleoWalletAdapter
  BaseAleoWalletAdapter, // from @provablehq/aleo-wallet-adaptor-core
} from '@provablehq/veil-wallet-adapter'
```

`AnyWalletAdapter` is the type accepted by `fromWalletAdapter()`. Pass any official wallet adapter (Shield, Leo, Puzzle, Fox) directly, or implement `AleoWalletAdapter` for custom adapters.

## Records

```ts
import type {
  RecordProvider,
  StandaloneRecordScanner,
  OwnedRecord,
  OwnedRecordEncrypted,
} from '@provablehq/veil-core'
```

- **`RecordProvider`** — Interface for record scanning. Plugs into `recordProvider` on `LocalWalletClientConfig`. Implemented by `createLocalScanner()` and `createRemoteScanner()`.
- **`StandaloneRecordScanner`** — Scanner with an explicit view key. Used with `withRecords()` on a public client. Implemented by `createStandaloneScanner()`.
- **`OwnedRecord`** — A decrypted record with `recordName`, `programName`, `recordPlaintext`, and `spent`.
- **`OwnedRecordEncrypted`** — An encrypted record ciphertext before decryption.

## RSS Types

```ts
import type {
  RecordFilter,
  ResponseFilter,
  OwnedRecordsRequest,
} from '@provablehq/veil-core'
```

- **`RecordFilter`** — Filter criteria for record scanning (program, record name).
- **`ResponseFilter`** — Controls what fields are included in the response.
- **`OwnedRecordsRequest`** — Full request shape for RSS-backed scanners.
