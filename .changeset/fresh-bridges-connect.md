---
'@provablehq/aleo-bridge-sdk': minor
---

Replace flat executor and RPC configuration with registry-keyed EVM, Solana,
and Aleo clients. Add browser-wallet, viem-client, and local-key adapters,
live Solana fee and rent reads, and expiry-aware confirmation. Every client
has a public client by default, while wallet actions require the optional
wallet client explicitly in their signatures. Fund-moving actions expose optional
compact, versioned checkpoint hooks. Checkpoints carry reconstructable public
intent and submitted transaction identifiers but exclude private-mint secrets.
The read-only `recover({ checkpoint })` action returns an explicit `wait`, `resume`,
`complete`, `done`, or `failed` next step without resubmitting funds. Each bridge decorator action now has its own module,
with protocol mechanics isolated behind internal helpers. Pure call builders are
standalone utilities rather than bridge client methods.
Registry discovery actions are exported directly as `getAssets` and `getRoutes`.
The protocol-neutral lifecycle is now `prepare`, `quote`, `execute`,
`getStatus`, `waitForStatus`, `wait`, `recover`, `resume`, and `complete`. `prepare` selects structured
source and destination assets with an optional `bridgeProtocol` constraint;
encoded route ids are outputs rather than caller input. Private inbound
xReserve transfers expose an explicit destination-action state, and `complete`
submits exactly one caller-authorized Aleo mint. Native Veil wallet clients pass
directly to `createAleoClient`, while protocol-specific escape hatches remain
exported under the `hyperlane` and `xreserve` namespaces.
Quoting and execution dispatch from the prepared route, replacing chain- and
protocol-specific client methods and the longer transfer-suffixed names.
