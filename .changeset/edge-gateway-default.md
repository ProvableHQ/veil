---
'@provablehq/veil-aleo-sdk': minor
'@provablehq/veil-aleo-react-hooks': minor
'@provablehq/shield-swap-cli': minor
'@provablehq/veil-core': patch
'@provablehq/shield-swap-sdk': patch
'@provablehq/veil-aleo-wallet-adapter': patch
---

Default every hosted endpoint to the `edge.provable.com/api` gateway: the delegated prover, the record scanner, the React hook's node URL, and the shield-swap CLI's network URL. The gateway is unauthenticated and needs no consumer or JWT, so a client built from a private key and a network URL proves and scans out of the box; a provisioned key still goes through `auth`. The consumer model is retired: `registerProvableApi`, `createProvableSession`, and `authenticateProvableApi` are now no-ops that never touch the network, a `consumerId` + `apiKey` pair or a `credentialStore` is carried but never sent, and `username` is ignored. `authenticateProvableApi` no longer throws on a keyed or credential-less client; it resolves with `registered: false`, an optional `credentials`, and no `expiration`. Bumps `@provablehq/sdk` to 0.11.10, which makes the same default change in the underlying SDK.
