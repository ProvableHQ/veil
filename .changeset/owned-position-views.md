---
'@provablehq/shield-swap-sdk': minor
---

Add `getOwnedPositions` and `getOwnedPosition` read actions that enumerate the
account's liquidity positions from its PositionNFT records, joined with
on-chain mapping state and derived values (current token amounts, uncollected
fees), plus matching `shield_swap_get_owned_positions` /
`shield_swap_get_owned_position` agent and MCP tools and the
`listPositionNFTs` record helper.
