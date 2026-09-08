---
'@provablehq/shield-swap-sdk': minor
'@provablehq/shield-swap-cli': minor
---

Add position fill tracking. `getPositionFills` reconstructs a liquidity position's recent swap fills — the change in token0 and token1 backing its fixed liquidity across each pool swap — from the `positions` mapping, the DEX API's pool trade history, and the Aleo blocks that establish execution order; `watchPositionFills` runs the same replay and then streams new fills through `onFill`, polling the API with WebSocket wake-ups where available and stopping with a `PositionTrackingError` when the position's range or liquidity changes. Both mount on `shieldSwapActions`, and `getPositionFills` ships as the `shield_swap_get_position_fills` agent and MCP tool. The CLI gains `shield-swap fills --position <tokenId> [--history N] [--watch]`.
