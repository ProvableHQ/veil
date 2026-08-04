---
'@provablehq/shield-swap-sdk': patch
---

Keep `pickInsertHint` working without the optional WASM peer.

Walking the initialized-tick list reads the `ticks` mapping, which is keyed by a
hash of pool and tick — so it derives keys through `@provablehq/sdk`. `mint` calls
`pickInsertHint` whenever hints are omitted, and `mint` deliberately uses the soft
loader while `increaseLiquidity` never loads WASM at all, so making the hint walk
require the peer broke wallet-backed browser installs that previously minted fine.
That contradicted the design stated in `utils/sdk.ts`: read-only and wallet-backed
paths never touch WASM.

An absent peer now falls back to the slot's neighbours — one mapping read keyed by
the pool, deriving nothing, and exactly what this returned before the walk existed.
Callers with the peer keep the correct predecessor for any target; callers without
it are no worse off than before. The fallback is best-effort, correct only for a
target within one initialized tick of the current price, so a wallet-backed caller
needing a distant range should pass `tickLowerHint` and `tickUpperHint` explicitly.
