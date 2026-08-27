---
'@provablehq/shield-swap-sdk': minor
---

Track the amm-v3 rebalance release: re-pin the shield_swap.aleo ABI (testnet edition 2, adds `rebalance_position`), generate bindings for the new `shield_swap_rebalance_router.aleo`, and add `planRebalance`/`rebalancePosition` actions: a rebalance plan prices the full close (principal, owed balances, and fees accrued past the checkpoints) against live or caller-supplied state, sizes by exact liquidity target or per-token funding budget, and submits atomically through the router's 14 entrypoints — or accepts a caller-built plan spread into the flat call parameters.
