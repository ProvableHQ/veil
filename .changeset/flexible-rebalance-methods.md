---
'@provablehq/shield-swap-sdk': minor
'@provablehq/shield-swap-cli': minor
---

Add exact-amount, exact-liquidity, and amount-driven rebalance helpers and matching planners. Extend rebalancePosition with token caps, minimums, fixed funding and refunds, and execution-time liquidity sizing while preserving existing exact-quote calls. Add the rebalance CLI command with plan-only defaults.

Preserve submission of complete rebalance plans merged with their original funding-budget parameters, including through the exact-amount helper. Keep the general executor's explicit liquidity target precedence over funding budgets.
