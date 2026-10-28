---
"@provablehq/aleo-bridge-sdk": minor
---

Support Shield-compatible xReserve private mints for local Aleo accounts. The
SDK now reserves persistent counters, derives the scalar and BHP256 address
commitment locally, checkpoints only the public commitment, and retrieves the
scalar from its identity store when submitting `private_mint`.

A quoted plan carries its reserved commitment under `plan.circle`, so
`execute({ plan: quote.plan })` deposits against the quoted identity instead of
reserving a second one, and rejects a conflicting commitment, wallet
preparation, or legacy nonce.

Group every Circle-specific option under a `circle` key: the identity store,
reserved commitment, wallet preparation, nonce input, and legacy secret nonce
for xReserve private mints, and the manual-mint and approval-replacement
overrides for CCTP. The bridge client takes the identity store as
`circle.privateMintIdentities` and supplies it to quote, execute, and complete.
The flat `privateMintSecretNonce` and `cctp` call options are deprecated and
still accepted; a field supplied in both forms with different values is
rejected.

The Node identity store atomically replaces files with `0600` permissions and
locks reservations across processes sharing the same path. A regular file left
at the lock path fails the reservation immediately with its cause instead of
waiting out the lock deadline.

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

Require an explicit shared identity store for automatic local derivation in
standalone actions, rather than discarding the only scalar in a temporary store.
Client-bound actions retain their configured default. Publish initialized locks
with unique owner files and reclaim only a confirmed dead owner's file, so
concurrent stale-lock recovery cannot delete a replacement live lock. Foreign
and unrecognized owners fail closed and require operator verification.

Validate quoted store-managed identities and explicitly supplied stores before
source approval or deposit submission. Reject absent identities and recipient
mismatches before funds move. Retain external commitment provenance on quoted
plans so an implicit client memory store does not override caller-managed
nonces. Lock timeout errors identify the last observed process and host without
claiming that the observation still represents the current owner.
