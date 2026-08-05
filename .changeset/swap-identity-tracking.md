---
'@provablehq/shield-swap-sdk': minor
---

Track blinded identities inside the swap actions when a store is configured.

Reservation existed but had to be driven by hand — reserve, swap, record — and the
default path still derived identities by scanning the chain, which is safe in
sequence and reverts in parallel. `swap` and `swapMultiHop` now reserve before
submitting and record the resulting handle after, and `claimSwapOutput` marks the
identity claimed. Two concurrent `client.swap()` calls can no longer collide.

Tracking follows the store. `shieldSwapActions` supplies an in-memory one when
none is configured, so a composed client is concurrency-safe out of the box —
without persistence, so a restart rescans the chain for its next counter and
forgets any unclaimed swap. Configure `fileBlindedIdentityStore` for anything
long-running. The standalone `swap(client, params)` tracks only when handed a
store, so its behaviour is unchanged from before.

Two per-call opt-outs, and no boolean flag to contradict the config: pass
`blindedIdentity` to supply your own identity, or `blindedIdentities: undefined` to
skip tracking for that call. Wallet accounts are untouched either way, since they
derive identities the client never sees.

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

`getUnclaimedSwaps` summarizes what a store is still owed: one entry per output
still sitting in `swap_outputs`, per-token totals across both sides of every swap
(the output token plus any unfilled input a claim refunds), and a handle rebuilt
from the store so each entry can be claimed by a process that did not make the
swap. It reads the mapping rather than trusting stored statuses, so an entry
appears exactly when a claim would succeed. Identities the chain has consumed whose
swap id was never recorded are reported separately as `unresolvable`, since nothing
on chain locates their proceeds until a claim exists.
