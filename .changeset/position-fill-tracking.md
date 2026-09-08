---
'@provablehq/shield-swap-sdk': minor
'@provablehq/shield-swap-cli': minor
---

Add position fill tracking. `getPositionFills` reconstructs one or more liquidity positions' recent swap fills — the change in token0 and token1 backing each position's fixed liquidity across each pool swap — from the `positions` mapping, the DEX API's pool trade history, and the Aleo blocks that establish execution order; positions in one pool share its history read, and the window is either the last N fills per pool (`history`) or everything since a block height (`fromBlock`). `watchPositionFills` runs the same replay and then streams new fills through `onFill`, polling the API with WebSocket wake-ups where available, dropping a position with a `PositionTrackingError` when its range or liquidity changes and stopping once none remain. Both mount on `shieldSwapActions`, and `getPositionFills` ships as the `shield_swap_get_position_fills` agent and MCP tool. The CLI gains `shield-swap fills --position <tokenId>... | --all [--history N | --from-block H] [--watch]`.
