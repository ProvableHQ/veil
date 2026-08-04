---
'@provablehq/shield-swap-sdk': minor
---

Return the true predecessor from `pickInsertHint`, and export the tick-list sentinels.

`pickInsertHint` read only `slot.next_init_below` / `next_init_above`, which
bracket the pool's *current* tick rather than the target. Any position bound
further out than one initialized tick therefore got a hint above itself, which the
contract rejects on finalize — the transaction is mined, reverts, and consumes the
fee. On a live ETH/USDCx pool at tick `-200996`, a lower bound of `-203230`
returned `-200996`; the correct predecessor is `-273894`. The docblock carried this
as a known limitation with an exact walk listed as a follow-up. This is that
follow-up: it now walks the initialized-tick list, which holds one entry per
initialized tick — 3 to 18 on live pools — so the added reads are few and bounded.

`MIN_TICK_SENTINEL` and `MAX_TICK_SENTINEL` are now exported. The list is anchored
one step outside the usable range (`∓400_001`, against `MIN_TICK`/`MAX_TICK` of
`∓400_000`), and with no constant for it callers hardcoded `-400001` — as the
devnode lifecycle tests did, which works only for a pool whose tick list is still
empty.

Verified against every live testnet pool: 30 hints across 5 pools, each confirmed
initialized, strictly below its target, and with its successor at or beyond the
target.
