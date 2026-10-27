---
"@provablehq/veil-aleo-sdk": minor
"@provablehq/veil-aleo-devnode": minor
---

Move to the snarkVM 4.12.0 toolchain: `@provablehq/sdk` 0.13.0 and
`@provablehq/aleo-devnode` 0.4.0. snarkVM 4.12 validates the devnode
consensus-heights list — exactly one entry per consensus version, first height
0, scheduled heights strictly increasing, and only a `u32::MAX` tail may
repeat — and panics inside the WASM on a list that breaks it, which the
previous all-at-genesis default did. The default list on both the SDK devnode
client and the devnode launcher now equals snarkVM's built-in
`TEST_CONSENSUS_VERSION_HEIGHTS` (`0,5,6,…,25`): V1 at genesis, V2–V22 one
block apart. aleo-devnode auto-advances to height 25 at startup, so a ready
node runs the latest consensus version (V22) before the first caller
transaction. A caller who sets `CONSENSUS_VERSION_HEIGHTS` explicitly MUST pass
twenty-two heights that satisfy the same rules.
