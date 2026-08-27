---
'@provablehq/shield-swap-sdk': minor
---

Track the amm-v3 rebalance release: re-pin the shield_swap.aleo ABI (testnet edition 2, adds `rebalance_position`), generate bindings for the new `shield_swap_rebalance_router.aleo`, and add `previewRebalance`/`rebalancePosition` actions that quote and submit an atomic close-refund-remint through the router's 14 entrypoints.
