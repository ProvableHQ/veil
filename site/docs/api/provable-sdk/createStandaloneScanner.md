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
  url: 'https://edge.provable.com/api/scanner',
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
- **Optional**

Consumer id for the legacy JWT model, paired with `apiKey`. Omit both for the
default gateway, which needs no consumer.

### viewKey

- **Type:** `string`

Aleo view key (`AViewKey1...`) to scan and decrypt records with.

### apiKey

- **Type:** `string`
- **Optional**

API key for the legacy JWT model, paired with `consumerId`. A session mints the
JWT when `url` names a legacy gateway such as `https://api.provable.com/scanner`;
on the default gateway the pair is carried and nothing mints. For a provisioned
gateway key use `auth`; omit both for the default gateway.

### startBlock

- **Type:** `number`
- **Optional**
- **Default:** `0`

Block height to begin scanning from at registration; the default scans full
history.
