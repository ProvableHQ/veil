---
"@provablehq/aleo-bridge-sdk": minor
---

Refuse to bridge over a paused route. Every active route in the registry now
declares the on-chain pause flags it depends on: the `pause`, `paused`, or
`pause__` mapping of each Aleo program in the route and the OpenZeppelin
`paused()` view of the xReserve contract and CCTP MessageTransmitter. The new
`getRouteStatus` action (also `client.getRouteStatus` and the
`bridge_get_route_status` agent and MCP tool) reads them all and reports each
flag's outcome. `quote` results carry `paused` and `routeStatus`, and `execute`,
`resume`, and `complete` throw `BridgeRoutePausedError` (a `BridgeError`)
naming the paused program or contract before touching a wallet. A flag that cannot be read never
blocks, since the chain enforces the pause; `skipRouteStatus: true` skips the
reads entirely. All additions are optional, so existing integrations keep
compiling and behaving.
