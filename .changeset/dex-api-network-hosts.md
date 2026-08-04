---
'@provablehq/shield-swap-sdk': minor
---

Derive the DEX API host from the client's network.

`DEFAULT_API_URL` shipped as `amm-api.dev.provable.com`, which indexes the
pre-migration `shield_swap_v3.aleo`. Since #110 moved this SDK to
`shield_swap.aleo`, that host serves pools which do not exist on the program the
SDK reads and proves against — so pool discovery returned keys and every chain
read of them came back `null`, surfacing as "pool does not exist" rather than as a
misconfigured URL.

The API is deployed per-network on separate hosts, so a single constant cannot be
right for both. `shieldSwapActions` now derives it from the client's network —
`mainnet` to `api.swap.shield.fi`, otherwise `api.testnet.swap.shield.fi` — and an
explicit `api.baseUrl` still wins. `SHIELD_SWAP_API_URLS` and `defaultApiUrl()`
are exported for callers constructing an `ApiClient` directly.

The host resolves per request rather than at construction, so `switchChain`
re-targets the API instead of leaving it on the network the client started from.
`ApiClientOptions.baseUrl` accordingly accepts `string | (() => string)`, and
`ApiClient.baseUrl` becomes a getter — still a readable string.

`DEFAULT_API_URL` is deprecated and now points at the testnet host. It is removed
in the next major; a caller who needs a specific network should use
`defaultApiUrl(network)`.

Three integration suites defaulted to `amm-api-staging.dev.provable.com`, which
now returns 404 for everything. They default to the testnet host instead — with it,
35 previously-failing live tests pass, including the route-quote test recorded as
known-red.
