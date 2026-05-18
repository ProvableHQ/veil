---
sidebar_position: 4
---

# Types

Core type definitions exported from `@veil/core`.

## Clients

```ts
import type {
  Client,
  PublicClient,
  WalletClient,
  TestClient,
  ClientConfig,
  PublicClientConfig,
  WalletClientConfig,
  RpcWalletClientConfig,
  LocalWalletClientConfig,
  TestClientConfig,
  PublicActions,
  WalletActions,
  TestActions,
} from '@veil/core'
```

- **`Client`** — Base client with `account`, `transport`, `proving`, `request`, `extend`.
- **`PublicClient`** — `Client` + `PublicActions` (`createPublicClient`).
- **`WalletClient`** — `Client` + `WalletActions` + `recordProvider` (`createWalletClient`).
- **`TestClient`** — `Client` + `TestActions` (`createTestClient`).
- **`WalletClientConfig`** — Discriminated union of `RpcWalletClientConfig` (wallet handles records) and `LocalWalletClientConfig` (must supply `proving`, optionally `recordProvider`).

## Accounts

```ts
import type {
  Account,
  SignerAccount,
  AnyAccount,
  LocalAccount,
  RpcAccount,
} from '@veil/core'
```

- **`Account`** — Address only (`{ address }`).
- **`SignerAccount`** — `Account` with `sign` / `signMessage`.
- **`RpcAccount`** — `type: 'rpc'`. Signing delegated to wallet. Created by `rpcAccount()` / `fromWalletAdapter()`.
- **`LocalAccount<source>`** — `type: 'local'`, has `privateKey`, `viewKey`, and a `source` tag (`'privateKey'` or `'mnemonic'`). Created by `aleo.privateKeyToAccount()` or `aleo.mnemonicToAccount()` from `@veil/provable`.
- **`AnyAccount`** — Union of `LocalAccount | RpcAccount`.

## Transport

```ts
import type { Transport, TransportConfig, RequestFn } from '@veil/core'
```

## Proving

```ts
import type {
  ProvingConfig,
  BuildTransactionOptions,
  BuildDeploymentOptions,
  SimulateOptions,
  ExecuteOptions,
  RawSimulateResult,
  RawExecuteResult,
  RawTransitionResult,
} from '@veil/core'
```

- **`ProvingConfig`** — Hosts `buildTransaction`, `buildDeployment`, `simulate`, `execute`, `decrypt`, and `switchNetwork`. `mode` is `'delegated'` (DPS prover service), `'local'` (in-process WASM), or `'devnode'` (used by `createDevnodeClient`).
- **`RawTransitionResult`** — Per-transition payload returned by `simulate`/`execute` before ABI parsing: `{ transitionId, program, function, outputs }`.

## Wallet Adapter

```ts
import type {
  AleoWalletAdapter,    // minimal interface for custom adapters
  AnyWalletAdapter,     // union of AleoWalletAdapter | BaseAleoWalletAdapter
  BaseAleoWalletAdapter, // from @provablehq/aleo-wallet-adaptor-core
} from '@veil/wallet-adapter'
```

`AnyWalletAdapter` is the type accepted by `fromWalletAdapter()`. Pass any official wallet adapter (Shield, Leo, Puzzle, Fox) directly, or implement `AleoWalletAdapter` for custom adapters.

## Records

```ts
import type {
  RecordProvider,
  StandaloneRecordScanner,
  OwnedRecord,
  OwnedRecordEncrypted,
  RecordStatusFilter,
  RequestRecordsParameters,
} from '@veil/core'
```

- **`RecordProvider`** — Interface for record scanning. Plugs into `recordProvider` on `LocalWalletClientConfig`. Implemented by `aleo.createRemoteScanner()`.
- **`StandaloneRecordScanner`** — Scanner with an explicit view key. Used with the `withRecords()` extension on a public client. Implemented by `aleo.createStandaloneScanner()`.
- **`OwnedRecord`** — A decrypted record with `recordName`, `programName`, `recordPlaintext`, and `spent`.
- **`OwnedRecordEncrypted`** — An encrypted record ciphertext before decryption.
- **`RecordStatusFilter`** — `'all' | 'spent' | 'unspent'`.

## RSS Types

```ts
import type {
  RecordFilter,
  ResponseFilter,
  OwnedRecordsRequest,
} from '@veil/core'
```

- **`RecordFilter`** — Filter criteria for record scanning (program, record name).
- **`ResponseFilter`** — Controls what fields are included in the response.
- **`OwnedRecordsRequest`** — Full request shape for RSS-backed scanners.

## ABI / Contract

```ts
import type {
  ABI,
  AbiFunction,
  AbiInput,
  AbiOutput,
  FunctionInput,
  FunctionOutput,
  StructDef,
  RecordDef,
  Mapping,
  StorageType,
  ParsedOutput,
  ParsedRecordOutput,
  ParsedPlaintextOutput,
  EncryptedRecordOutput,
  ParsedFutureOutput,
  InputValue,
  TransitionResult,
  ExecuteResult,
  SimulateResult,
  FunctionNames,
  MappingNames,
  TypedContractInstance,
} from '@veil/core'
```

These back `getContract()` / `parseAbi()` / `parseProgram()` and the typed `contract.simulate.*` / `contract.execute.*` surfaces.

## Wallet Standard

```ts
import type { Network, TransactionStatusResponse, TxHistoryResult } from '@veil/core'
```

- **`Network`** — `'mainnet' | 'testnet' | (string & {})` — known values autocomplete, unknown strings are accepted so new networks don't force a type bump.
- **`TransactionStatusResponse`** — `{ status: string; transactionId?: string; error?: string }`. Status values: `accepted` / `rejected` / `pending` / `not_found`.
