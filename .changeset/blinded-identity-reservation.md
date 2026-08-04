---
'@provablehq/shield-swap-sdk': minor
---

Reserve blinded identities through a store, and expose `resolveDexImports` as an action.

Swaps that ran in parallel from one local account reverted on finalize. A swap is
bound to a blinded identity, and the program asserts each blinded address appears
in `used_blinded_addresses` only once. With no `blindedIdentity` passed, `swap` and
`swapMultiHop` called `nextBlindedIdentity`, which scans for the first counter the
chain does not carry — correct in sequence, wrong in parallel. Two concurrent swaps
read the same unused counter and the second reverted, with nothing to see locally
because at proving time the address genuinely was unused. Disjoint input tokens did
not help: the identity is per account, not per token.

`reserveBlindedIdentity` closes the window by recording a reservation before
returning it, and never issuing a counter at or below one already stored — so an
unconfirmed swap still holds its counter. It moves monotonically from the highest
known counter, and skips any address the chain already carries, which recovers a
store another process has moved past. An empty store scans from 0, so a lost store
costs reads rather than correctness. Local accounts only: a wallet derives and
tracks its own identities.

Reservations persist through a `BlindedIdentityStore`.
`memoryBlindedIdentityStore` is the default — enough to keep one process's
concurrent swaps apart — and `fileBlindedIdentityStore` on the new
`@provablehq/shield-swap-sdk/node` entry point persists them across restarts, which
is what a bot or a test suite wants. Configure either with
`shieldSwapActions({ blindedIdentities })`.

`recordBlindedSwap` attaches a swap id to a reservation, and
`syncBlindedIdentities` reconciles the store against the chain: `reserved` until
the address appears on chain, then `swapped` while its output is unclaimed and
`claimed` once the claim consumes it. That makes proceeds recoverable after a
crash — an identity is otherwise unrecoverable, since it is derived rather than
recorded anywhere the account can see.

`resolveDexImports` is now on the client as `client.resolveDexImports()` alongside
the standalone export, which is unchanged. Every write needs its result and it
already took `(client, params)`, so the action form removes an import for callers
who have a composed client.
