---
'@provablehq/veil-aleo-sdk': minor
'@provablehq/veil-aleo-react-hooks': minor
'@provablehq/shield-swap-cli': minor
'@provablehq/veil-core': patch
'@provablehq/shield-swap-sdk': patch
'@provablehq/veil-aleo-wallet-adapter': patch
---

Default every hosted endpoint to the `edge.provable.com/api` gateway: the delegated prover, the record scanner, the React hook's node URL, and the shield-swap CLI's network URL. The gateway is unauthenticated and needs no consumer or JWT, so a client built from a private key and a network URL proves and scans out of the box; a provisioned key still goes through `auth`. The legacy JWT model stays supported for a caller who points the client at a legacy gateway: with `proverUrl` or the scanner `url` on `https://api.provable.com/...` and a `consumerId` + `apiKey` pair (or a `credentialStore`), a session mints at that gateway's `/jwts` and injects the token. On the default gateway the pair is carried and nothing mints. Consumer registration is retired: `registerProvableApi` is a no-op that resolves `undefined`, `username` is ignored, and a client without a pair never registers one. `authenticateProvableApi` no longer throws on a keyed or credential-less client; it resolves with `registered: false` and, without a pair, no `credentials` and no `expiration`. Bumps `@provablehq/sdk` to 0.11.10, which makes the same default change in the underlying SDK.
