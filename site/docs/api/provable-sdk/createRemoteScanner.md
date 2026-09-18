---
sidebar_position: 12
---

# createRemoteScanner

Creates a `RecordProvider` backed by Provable's Record Scanner Service (RSS),
usable as `recordProvider` in [`createWalletClient`](/clients/wallet-client)
or passed to [`createAleoClient`](./createAleoClient)'s `records` option.

The first `requestRecords` call registers the account's view key with the
service — a network round trip — to obtain the UUID scanning requires;
subsequent calls reuse it. `setAccount` resets the registration, so switching
accounts re-registers on the next scan. The provider implements
`switchNetwork`, so a wallet client carrying it re-targets record scanning
when `switchChain` runs — the scanner rebuilds against the new network and
re-registers lazily on the next scan.

## Usage

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const account = aleo.privateKeyToAccount('APrivateKey1...')

const records = aleo.createRemoteScanner({
  url: 'https://edge.provable.com/api/scanner',
})

records.setAccount({ viewKey: account.viewKey })
const owned = await records.requestRecords({ program: 'credits.aleo' })
```

## Returns

`RecordProvider`

An object with `requestRecords`, `setAccount`, and `switchNetwork`, matching
the shape [`createWalletClient`](/clients/wallet-client) expects for its
`recordProvider` config.

## Parameters

### url

- **Type:** `string`

Base URL of the Record Scanner Service. The SDK appends the network segment
— do not include it.

### consumerId

- **Type:** `string`
- **Optional**

Legacy consumer id from the retired consumer model. Accepted so existing
configuration keeps loading; the hosted scanner needs no consumer.

### apiKey

- **Type:** `string`
- **Optional**

Legacy API key paired with `consumerId`. Nothing is sent or minted from it.
For a provisioned gateway key use `auth`; omit both for the hosted scanner.

### startBlock

- **Type:** `number`
- **Optional**
- **Default:** `0`

Block height to begin scanning from at registration; the default scans full
history.
