---
'@provablehq/shield-swap-sdk': minor
---

Rename the DEX authentication action to `authenticateShieldSwap`.

`authenticateApi` did not say which API it signs into, and that became ambiguous
now that a client can also carry `authenticateProvableApi` from
`@provablehq/veil-aleo-sdk` — two auth actions on one client, one naming its
service and one not. The two are unrelated: this one signs a nonce with the
account and yields a DEX session; the other exchanges a consumer key for a JWT
covering delegated proving and record scanning.

`authenticateApi` remains as a deprecated alias with identical behaviour and is
removed in the next major, so upgrading this minor breaks nothing. Both names
call the same function rather than one wrapping the other, so they cannot drift.
