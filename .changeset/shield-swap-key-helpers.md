---
"@provablehq/shield-swap-sdk": patch
---

Add `derivePoolKey` and `deriveTickKey`: derive a pool or tick key locally from `(token0, token1, fee)` or `(pool, tick)` via BHP256 struct hashing, matching the contract byte-for-byte (the pool pair is sorted ascending), without a `getPools` network round trip. BHP256 hashing uses the optional `@provablehq/sdk` peer, loaded lazily on first call — read-only and wallet-backed paths never pull in the WASM SDK.
