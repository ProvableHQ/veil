---
sidebar_position: 4
---

# Types

Core type definitions exported from `@veil/core`.

## Clients

```ts
import type { Client, PublicClient, WalletClient } from '@veil/core'
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
} from '@veil/core'
```

- **`RpcAccount`** — `type: 'rpc'`. Signing delegated to wallet. Created by `fromWalletAdapter()`.
- **`LocalAccount`** — `type: 'local'`. Has `privateKey`, `viewKey`. Created by `privateKeyToAccount()`.
- **`ViewOnlyAccount`** — `type: 'viewOnly'`. Has `viewKey`, cannot sign.

## Transport

```ts
import type { Transport } from '@veil/core'
```

## Wallet Adapter

```ts
import type {
  AleoWalletAdapter,    // minimal interface for custom adapters
  AnyWalletAdapter,     // union of AleoWalletAdapter | BaseAleoWalletAdapter
  BaseAleoWalletAdapter, // from @provablehq/aleo-wallet-adaptor-core
} from '@veil/wallet-adapter'
```

`AnyWalletAdapter` is the type accepted by `fromWalletAdapter()`. Pass any official wallet adapter (Shield, Leo, Puzzle, Fox) directly, or implement `AleoWalletAdapter` for custom adapters.
