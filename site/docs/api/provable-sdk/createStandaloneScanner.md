---
sidebar_position: 13
---

# createStandaloneScanner

Creates a `StandaloneRecordScanner` backed by Provable's Record Scanner
Service (RSS) from an explicit view key, for use outside a wallet client —
view-only dashboards, auditing, or any case that needs scanned records
without a signer. Not pluggable into a wallet client's `recordProvider`; use
[`createRemoteScanner`](./createRemoteScanner) for that.

Like `createRemoteScanner`, the first `requestRecords` call registers the
view key with the service — a network round trip — to obtain the scanning
UUID; subsequent calls reuse it.

## Usage

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')

const scanner = aleo.createStandaloneScanner({
  url: 'https://api.provable.com/v2',
  consumerId: '<consumer-id>',
  viewKey: 'AViewKey1...',
})

const owned = await scanner.requestRecords({ program: 'credits.aleo' })
```

## Returns

`StandaloneRecordScanner`

An object exposing a single `requestRecords` method scoped to the configured
view key.

## Parameters

### url

- **Type:** `string`

Base URL of the Record Scanner Service. The SDK appends the network segment.

### consumerId

- **Type:** `string`

Consumer id used to mint and refresh the JWT the service authenticates with.

### viewKey

- **Type:** `string`

Aleo view key (`AViewKey1...`) to scan and decrypt records with.

### apiKey

- **Type:** `string`
- **Optional**

API key for an authenticated service instance. Omit for an open,
unauthenticated service.

### startBlock

- **Type:** `number`
- **Optional**
- **Default:** `0`

Block height to begin scanning from at registration; the default scans full
history.
