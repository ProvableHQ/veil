---
'@provablehq/veil-core': minor
'@provablehq/veil-aleo-sdk': minor
---

Shorten the confirmation window to one minute, and report what the polls saw.

`waitForConfirmation` defaulted to 300 seconds. Measured against the live testnet
deployment, healthy confirmations land far inside that — a mint took 49.7s and an
increase 39s, both including proving — so a transaction still absent at the limit
is more often one the node never included than one about to arrive. The default is
now 60_000, and callers on a congested network or a slower path raise it per client.

This is a behaviour change: a write that previously confirmed between one and five
minutes now throws `TransactionTimeoutError` instead of returning. Multi-hop swaps
are the known case — one was measured at 322 seconds — and a client submitting them
should set `confirmationTimeout` explicitly (around `400_000`) rather than take the
default. The shield-swap README and the `createProvingConfig` reference both say so
on the multi-hop path.

The timeout error also reports what the polls observed. Every polling failure was
previously swallowed, so a node that answered cleanly and consistently did not have
the transaction was indistinguishable from one that could not be reached — and the
message asserted the transaction "may still be pending", which is exactly backwards
for a transaction that was dropped before inclusion. `TransactionTimeoutError` now
carries `polls` and `absentPolls`, and its message states which case it saw. It does
not diagnose why: the confirmed-transaction endpoint cannot tell a pending
transaction from a dropped one on its own, so the message reports the observation
and leaves the conclusion to the caller.
