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

For the full option set on each transport (`http`'s `network`, `fetchFn`,
and `headers`; `custom`'s `request`; `fallback`'s multi-transport error
behavior) and the underlying `Transport`/`TransportConfig` shape, see the
[Transports reference](/api/transports).
