---
sidebar_position: 8
---

# createNetworkClient

Creates an `AleoNetworkClient` instance from `@provablehq/sdk` for direct
access to the underlying SDK's network client. Applies when a call needs an
SDK method Veil does not wrap. It forgoes the typed action surface
(`getBalance`, `writeContract`, and the rest) that
[`createPublicClient`](/clients/public-client) and
[`createWalletClient`](/clients/wallet-client) provide, so most reads and
writes go through those instead.

## Usage

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')

const networkClient = aleo.createNetworkClient('https://api.provable.com/v2')
```

## Returns

`AleoNetworkClient`

An instance of the SDK's network client, bound to the given URL and to this
handle's loaded network binaries.

## Parameters

### url

- **Type:** `string`

Base URL of the Aleo node's REST API.
