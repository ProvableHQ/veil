---
'@provablehq/shield-swap-sdk': patch
---

`getOwnedPositions` no longer opens every position's mapping reads at once. It resolves positions through a bounded worker pool (`concurrency`, default 8, so at most about 32 reads in flight) and retries a read the gateway refused with a 429 or 5xx or dropped with a connection reset, backing off from 250 ms over four attempts. An account holding ~60 positions previously fanned out ~230 concurrent requests and failed the whole call on a single `ECONNRESET`. `getOwnedPosition` shares the retry. The retry and pool helpers move to a shared module also used by `reconcileSwapHistory`, whose retry now covers connection-level failures as well as busy responses.
