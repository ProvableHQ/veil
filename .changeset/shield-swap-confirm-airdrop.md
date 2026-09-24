---
'@provablehq/shield-swap-sdk': minor
---

Add `ApiClient.confirmAirdrop(address, options?)`, which requests a testnet faucet drop and polls the job until it settles. It returns `{ status: 'settled', job }` with the per-token results, or `{ status: 'rate_limited', message }` when the faucet refuses the address for its per-address window, so a caller holding funds from an earlier drop can carry on without catching a 429. Other API errors propagate, and a job still running at `timeoutMs` (default ten minutes) throws with its progress. The `ConfirmAirdropResult` type is exported.
