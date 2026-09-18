---
'@provablehq/veil-aleo-sdk': minor
'@provablehq/veil-aleo-react-hooks': minor
'@provablehq/shield-swap-cli': minor
'@provablehq/veil-core': patch
'@provablehq/shield-swap-sdk': patch
'@provablehq/veil-aleo-wallet-adapter': patch
---

Default every hosted endpoint to the `edge.provable.com/api` gateway: the delegated prover, the record scanner, the React hook's node URL, and the shield-swap CLI's network URL. Edge is unauthenticated, so a client with no credentials works out of the box. A bare `consumerId` + `apiKey` pair now mints its JWT through a session at the Provable API root instead of at the prover or scanner origin, so existing pairs keep working against edge. Consumer registration and JWT minting stay on `api.provable.com`, which edge does not serve. Bumps `@provablehq/sdk` to 0.11.10, which makes the same default change in the underlying SDK.
