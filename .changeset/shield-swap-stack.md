---
"@provablehq/shield-swap-sdk": minor
---

Retarget the SDK to the `shield_swap.aleo` stack (core AMM, swap router, LP router, freezelist, multisig, and the token wrappers). Breaking, hard cutover — `shield_swap_v3.aleo` support is removed.

- **Wrappers are hidden.** Callers name only tokens, amounts, and pools; the SDK resolves each token's wrapped-ness on chain (`from_wrapper_token_id`) and dispatches to `shield_swap.aleo` or the correct router transition internally. `swap`/`swapMultiHop` no longer take `tokenInProgram`.
- **Q128.128 prices.** Tick and price math moved from Q64 to Q128.128 (`getSqrtPriceAtTickX128`, `getTickEstimateX128`, `U256` sqrt-price literals). `getSqrtPriceAtTick`/`MIN_SQRT_PRICE` and the `scale0`/`scale1` pool fields are gone.
- **Immutable withdrawal address** is required on mint and fixed for the position's life; `collect` supports an owner distinct from the withdrawal address.
- **Unified claim.** `claimSwapOutput` serves both single- and multi-hop swaps and routes the payout (wrapped vs plain) internally; `claimMultiHopOutput` is removed.
- Token/balance reads follow the migrated API shape (`amm_token_program` + `underlying_program` + `underlying_token_id`, replacing `wrapper_program`); private-balance scans key on `underlying_program` and read `credits.aleo` `microcredits`.
