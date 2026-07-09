---
sidebar_position: 3
---

# Transports API

## http

Creates an HTTP transport for connecting to an Aleo RPC endpoint.

```ts
import { http } from '@provablehq/veil-core'

const transport = http(url, config?)
```

| Parameter | Type | Description |
|---|---|---|
| `url` | `string` | RPC endpoint URL |
| `config.network` | `'mainnet' \| 'testnet'` | Network (default: `'mainnet'`) |
| `config.fetchFn` | `typeof fetch` | Custom fetch implementation |
| `config.headers` | `Record<string, string>` | Additional HTTP headers |

## custom

Wraps a custom request function as a transport.

```ts
import { custom } from '@provablehq/veil-core'

const transport = custom({
  key: 'myTransport',
  name: 'My Transport',
  request: async ({ method, params }) => { ... },
})
```

## fallback

Tries multiple transports in order. Returns the first successful response.

```ts
import { fallback } from '@provablehq/veil-core'

const transport = fallback([transport1, transport2])
```

If all transports fail, throws with the first transport's error message.
