---
sidebar_position: 8
---

# createNetworkClient

Creates an `AleoNetworkClient` instance from `@provablehq/sdk` for direct
access to the underlying SDK's network client. Applies when a call needs an
SDK method Veil does not wrap; bypasses the retry, fallback, and
error-classification behavior [`createPublicClient`](/clients/public-client)
and [`createWalletClient`](/clients/wallet-client) add on top, so most reads
and writes go through those instead.

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
