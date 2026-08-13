---
"@provablehq/veil-core": minor
"@provablehq/veil-aleo-sdk": minor
---

Parameterize record scans with Record Scanning Service filters.

`requestRecords` now accepts a nested `filter` carrying the service's row
bounds — record type, producing function, commitment, and block range — plus
pagination, so a scan returns only the records a caller asked for. A local
account pushes the bounds to the service; a wallet (RPC) account cannot
forward them, so Veil applies the same bounds to what the wallet returned.

`program` is now optional. Omitting it scans every program the account holds
records for. A wallet (RPC) account still requires it and throws when it is
absent, since the wallet-adapter protocol has no all-programs record request.

**Behavior change:** `statusFilter: 'all'` — the default — previously returned
unspent records only. It sent `unspent: true`, which the service reads as
`spent = false`, making `'all'` behave identically to `'unspent'`. The key is
now omitted for `'all'`, so it returns both spent and unspent records as
documented. Code that relied on the default to get spendable records should
pass `statusFilter: 'unspent'` explicitly.

Pagination was previously unreachable while the service clamps results to 1000
per page, so an account holding more matching records lost the remainder with
no signal. `resultsPerPage` and `page` now reach the service.

A filter bound can only be evaluated against a field a record carries. A
privacy-preserving wallet omits fields withheld under a `recordAccess` grant,
so a bound on a withheld field matches nothing rather than being ignored —
filter on granted fields, or scope with `program`, which every path carries.
