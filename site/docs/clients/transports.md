---
sidebar_position: 3
---

# Transports

A transport is the pipe a client uses to reach a node or wallet — every read
and write a client makes passes through its transport's `request` function.
Veil follows viem's transport model: a client owns the action surface
(`getBlock`, `writeContract`, and the rest) and hands the actual request off
to a swappable transport, so the same client code runs against an HTTP
endpoint, a connected wallet, or a test double by changing only the
transport passed to `createPublicClient`, `createWalletClient`, or
`createTestClient`.

Three transports ship with `@provablehq/veil-core`:

- **`http`** — the default. Talks to an Aleo node's REST API.
- **`custom`** — wraps any request function, most commonly a wallet
  adapter's own transport.
- **`fallback`** — tries a list of transports in order, first success wins.
  The common pairing is a wallet transport first (for writes) and an HTTP
  transport as backup (for reads):

```ts
import { fallback, http } from '@provablehq/veil-core'
import { transportFromAdapter } from '@provablehq/veil-aleo-wallet-adapter'

const transport = fallback([
  transportFromAdapter(walletAdapter),
  http('https://api.provable.com/v2'),
])
```

Every client — public, wallet, or test — takes a transport the same way,
through its `transport` config field. A test client typically points `http`
at a local devnode instead of a public endpoint:

```ts
import { http } from '@provablehq/veil-core'

const transport = http('http://127.0.0.1:3030', { network: 'testnet' })
```

## The client header

When the `http` transport points at a Provable-operated endpoint, it sends
an `X-Veil-Client: veil-core/<version>` header identifying the SDK. The
header goes to `provable.com` hosts only, without exception: those
endpoints allow it in their CORS configuration, while a self-hosted or
third-party node might not, and a browser request carrying a header the
server's `Access-Control-Allow-Headers` does not list fails outright.
Pointing the transport anywhere else sends no header at all.

Pass `clientHeader` to replace the value or turn the header off:

```ts
// Identify the app instead of the SDK.
const transport = http('https://api.provable.com/v2', {
  clientHeader: 'my-dapp/1.2',
})

// Never send the header.
const anonymous = http('https://api.provable.com/v2', { clientHeader: false })
```

An `X-Veil-Client` value set through `headers` (any casing) always wins over
the default.

To identify the client to a node Provable does not operate, set the header
explicitly through `headers` — it applies to any host, and the node's CORS
config MUST allow `X-Veil-Client` for browser requests to succeed:

```ts
const custom = http('https://my-node.example.com/v2', {
  headers: { 'X-Veil-Client': 'my-dapp/1.2' },
})
```

For the full option set on each transport (`http`'s `network`, `fetchFn`,
`headers`, and `clientHeader`; `custom`'s `request`; `fallback`'s
multi-transport error behavior) and the underlying
`Transport`/`TransportConfig` shape, see the
[Transports reference](/api/transports).
