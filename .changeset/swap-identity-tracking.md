---
'@provablehq/shield-swap-sdk': minor
---

Track blinded identities inside the swap actions when a store is configured.

Reservation existed but had to be driven by hand — reserve, swap, record — and the
default path still derived identities by scanning the chain, which is safe in
sequence and reverts in parallel. `swap` and `swapMultiHop` now reserve before
submitting and record the resulting handle after, and `claimSwapOutput` marks the
identity claimed. Two concurrent `client.swap()` calls can no longer collide.

Everything is conditional on `blindedIdentities` being configured. Without a store,
behaviour is exactly as before: chain-scan derivation, no local writes, no new
error paths. Passing `blindedIdentity` explicitly opts out per call — that is the
flag, so there is no boolean to contradict the config — and wallet accounts are
untouched, since they derive identities the client never sees.

Records now carry the whole handle, not just the swap id, because
`claimSwapOutput` consumes a handle. That makes crash recovery real: a process can
claim a swap it did not make. `SwapHandle` holds bigints and `JSON.stringify`
throws on those, so handles persist through an explicit shape with decimal strings
(`toPersistedHandle` / `fromPersistedHandle`) rather than a bigint reviver, which
cannot round-trip — a string field of digits would come back a bigint.
`recordBlindedSwap` accordingly takes `{ handle }` instead of
`{ blindedAddress, swapId }`.

Two deliberately asymmetric failure policies. A store write that fails *after* a
swap lands throws `SwapRecordingError` with the handle attached: the swap
succeeded, so resubmitting would spend more input, but the swap id is knowable
only at that moment — nothing on chain links an identity to its swap until a claim
exists — so a swallowed failure means unclaimable proceeds. A store write that
fails after a *claim* warns and continues, because the funds have landed and
`reconcileSwapHistory` can repair the record.
