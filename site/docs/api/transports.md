---
sidebar_position: 1
---

# Transports

A transport is the pipe a client uses to reach a node or wallet: every
request a client makes — a read, a write, a status check — passes through
its transport's `request` function. Veil follows viem's transport model: the
client owns the action surface (`getBlock`, `writeContract`, and so on) and
delegates the actual request to a swappable transport, so the same client
code runs against an HTTP endpoint, a wallet adapter, or a test double by
changing only the transport passed to `createPublicClient` or
`createWalletClient`. See [Transports](/clients/transports) for the
client-facing guide; this page is the full reference.

## Transport shape

```ts
import type { Network, RequestFn, Transport, TransportConfig } from '@provablehq/veil-core'
```

```ts
type RequestFn = (args: { method: string; params?: unknown }) => Promise<unknown>

type TransportConfig<type extends string = string> = {
  key: string
  name: string
  request: RequestFn
  type: type
  retryCount?: number
  retryDelay?: number
  timeout?: number
  network?: Network | null
}

type Transport<type extends string = string> = {
  config: TransportConfig<type>
  request: RequestFn
}
```

`RequestFn` takes an untyped `method` and `params` and resolves with an
untyped result; every action built on top of a client narrows that result to
a typed return value. `TransportConfig` declares `retryCount`, `retryDelay`,
and `timeout` for a transport implementation to interpret on its own terms —
`http()` does not read or act on them; a custom transport can honor them by
implementing its own retry or timeout loop around `request`.

## `createTransport`

```ts
import { createTransport } from '@provablehq/veil-core'

function createTransport<type extends string>(config: TransportConfig<type>): Transport<type>
```

The low-level constructor the built-in transports (`http`, `custom`,
`fallback`) are built on. It is pure and local: it lifts `config` into a
`Transport` and exposes `config.request` as the transport's `request`. Call
it directly only when defining a transport shape none of the built-ins
cover.

```ts
const transport = createTransport({
  key: 'custom',
  name: 'Custom Transport',
  type: 'custom',
  request: async ({ method, params }) => provider.request({ method, params }),
})
```

## `http`

```ts
import { http } from '@provablehq/veil-core'

function http(url: string, config?: HttpTransportConfig): Transport<'http'>
```

The default transport for reading the chain and broadcasting transactions.
Aleo's node API is REST, not JSON-RPC, so `http()` maps each Veil method name
to a REST path under `{url}/{network}` and issues the request; building the
transport is pure, and each call it makes performs a network request that
throws on a non-2xx response.

| Parameter | Type | Description |
| --- | --- | --- |
| `url` | `string` | Base URL of the Aleo node, without a trailing network segment (e.g. `https://api.provable.com/v2`). |
| `config.network` | `Network` | Optional. Network segment used in request paths. Defaults to `'mainnet'`. For local accounts, `switchChain` mutates this field to re-route reads at the new network's path segment. |
| `config.fetchFn` | `typeof fetch` | Optional. `fetch` implementation used for requests. Defaults to the global `fetch`; supply one for non-browser runtimes or tests. |
| `config.headers` | `Record<string, string>` | Optional. Headers merged into every request. Defaults to none; use for auth tokens or custom routing. |
| `config.key` | `string` | Optional. Transport key. Defaults to `'http'`. |
| `config.name` | `string` | Optional. Human-readable transport name. Defaults to `'HTTP Transport'`. |

```ts
import { http } from '@provablehq/veil-core'

const transport = http('https://api.provable.com/v2', { network: 'testnet' })
```

### Base URL resolution

Every request resolves against `{url}/{network}`, so `http('https://api.provable.com/v2', { network: 'testnet' })` issues requests under `https://api.provable.com/v2/testnet`. Each method maps to one REST path under that base — for example `getLatestHeight` reads `GET {base}/block/height/latest`, `getBalance` reads `GET {base}/program/credits.aleo/mapping/account/{address}`, and `sendTransaction` posts to `POST {base}/transaction/broadcast`. An unrecognized method throws `TransportError` before any request is issued; a non-2xx response throws `TransportError` with a message of the form `HTTP {status}: {response body}`.

## `custom`

```ts
import { custom } from '@provablehq/veil-core'

function custom(config: CustomTransportConfig): Transport<'custom'>
```

Wraps a caller-supplied request function as a transport. Use it to route
requests through an existing provider — an injected wallet, a proxy, or a
test double — instead of Veil's built-in HTTP path. Building the transport
is pure; `config.request` is what performs I/O when the transport is called.

| Parameter | Type | Description |
| --- | --- | --- |
| `config.request` | `RequestFn` | Function invoked for every call made through the transport. |
| `config.key` | `string` | Optional. Transport key. Defaults to `'custom'`. |
| `config.name` | `string` | Optional. Human-readable transport name. Defaults to `'Custom Transport'`. |

```ts
import { custom } from '@provablehq/veil-core'

const transport = custom({
  request: async ({ method, params }) => window.aleo.request({ method, params }),
})
```

## `fallback`

```ts
import { fallback } from '@provablehq/veil-core'

function fallback(transports: Transport[]): Transport<'fallback'>
```

Combines transports into one that tries each in order until a request
succeeds. The typical pairing is a wallet transport first, then an HTTP
transport as backup — the wallet handles writes and HTTP serves reads. On a
call, `fallback` invokes each transport in turn and returns the first
success; the returned transport carries no network of its own but inherits
one from the first supplied transport that declares one.

| Parameter | Type | Description |
| --- | --- | --- |
| `transports` | `Transport[]` | Transports to try in order, most preferred first. |

Throws `TransportError` if every transport fails; the message carries the
first transport's error, set as the thrown error's `cause`.

```ts
import { fallback, http, custom } from '@provablehq/veil-core'

const transport = fallback([
  custom({ request: (args) => wallet.request(args) }),
  http('https://api.provable.com/v2', { network: 'mainnet' }),
])
```
