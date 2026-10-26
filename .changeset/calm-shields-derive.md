---
"@provablehq/aleo-bridge-sdk": minor
---

Support Shield-compatible xReserve private mints for local Aleo accounts. The
SDK now reserves persistent counters, derives the scalar and BHP256 address
commitment locally, checkpoints only the public commitment, and retrieves the
scalar from its identity store when submitting `private_mint`.

The Node identity store atomically replaces files with `0600` permissions and
locks reservations across processes sharing the same path.

Align new nonce derivations with shield-core cc29a60's mainnet/testnet domain
separation, release temporary WASM handles, and persist allocation watermarks
before derivation so failed reservations cannot recycle counters. Back up the
Node identity file and its `.counter` companion together. Existing identities
continue to complete with their originally stored scalars.

Support wallet-prepared private mints without the application patch from AMM
PR #920. Quote, execute, and resume accept `walletPreparedDeposit`; completion
accepts the matching `privateMintNonceInput` derived request while the wallet
retains the scalar. Validate the reviewed wrapper, canonical hook, attested
commitment, recipient, and nonce-source exclusivity before submission, and
preserve the original hook when an approval confirms after a timeout.
