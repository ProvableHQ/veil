---
'@provablehq/shield-swap-sdk': patch
---

Keep deriving the DEX API host when `baseUrl` is passed as `undefined`.

`shieldSwapActions` built its `ApiClient` by setting the derived host and then
spreading the caller's `api` options over it. A caller writing
`baseUrl: process.env.VEIL_DEX_API_URL` with that variable unset passes the key
with an `undefined` value, and the spread let it beat the derived host — after
which `ApiClient` fell back to its deprecated testnet constant. A mainnet client
would then read pools that do not exist on the program it proves against, with
nothing in the configuration to suggest it. The coalesce is now applied after the
spread, so only a `baseUrl` that is actually set overrides the derivation.
