---
'@provablehq/shield-swap-sdk': minor
---

Derive insert hints from the DEX API when the WASM peer is unavailable.

`pickInsertHint` walks the contract's initialized-tick list, which needs
`@provablehq/sdk` to hash each tick key. Without the peer it fell back to the
slot's two neighbours — correct only for a target within one initialized tick of
the current price, and wrong for anything further out, which finalize rejects at
the caller's expense.

The API already answers this exactly. `GET /pools/{key}/initialized-ticks` returns
the pool's full sorted tick list, and its own description names the purpose:
computing `tick_lower_hint` / `tick_upper_hint` for the AMM's hint-walk asserts.
It is now exposed as `client.api.getInitializedTicks(poolKey)`, and
`shieldSwapActions` supplies it to `pickInsertHint`, `mint`, and
`increaseLiquidity` automatically — so a wallet-backed client with no WASM gets
the exact predecessor instead of a guess. Verified against three live testnet
pools: the API-derived predecessor matched the chain walk on every one.

Three sources now, in descending order of authority: the contract's own list
whenever the peer is present, the API list when it is not, and the slot's
neighbours only when neither is available. The chain stays preferred because the
API list is indexed from positions rather than read from the contract, so it can
lag a position minted moments ago — and a stale hint costs a fee. A failing or
unauthenticated API drops to the slot rather than failing the write.

`mint` and `increaseLiquidity` accept `initializedTicks` for callers driving them
outside the decorator.
