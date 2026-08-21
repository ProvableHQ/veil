---
'@provablehq/shield-swap-sdk': minor
---

Target the edition-1 shield_swap deployment: claims with a zero remainder now
dispatch to the no-refund transitions (claim_swap_output_no_refund on the core,
claim_to_arc20_no_refund / claim_to_wrapped_no_refund on the router), the wallet
grant list covers the new transitions, and two chain reads are added —
getPoolCreator (pool_creators) and getSwapExecution (per-hop execution receipts
with derived LP fees).
