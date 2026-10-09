---
"@provablehq/veil-core": minor
"@provablehq/veil-aleo-sdk": minor
"@provablehq/shield-swap-sdk": minor
"@provablehq/shield-swap-cli": minor
"@provablehq/veil-cli": minor
---

Add scanner-backed ARC20, ARC22, and native credits inventory actions, shared record reservations, and Shield Swap inventory wrappers. Add the separate Veil inventory CLI with bounded maintenance policies and a CLI-only SQLite recovery journal. SDK packages retain their existing runtime requirements.

Add configurable dynamic token join routing with batches of 2–15 records. Inventory plans preserve target counts, reservations, proved fee limits, and recovery while resolving dynamic router outputs to underlying token commitments. The CLI selects the network's deployed ARC router by default; native pairwise joins remain available.
