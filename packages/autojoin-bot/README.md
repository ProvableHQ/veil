# autojoin-bot

Programmatic Aleo autojoin implementation for JavaScript:

- [`js/`](js/README.md).

The implementation is a deliberately one-shot example. It uses the scanner as
its source of truth; its ciphertext and decrypted-record snapshots are
independent, opt-in exports and are both disabled by default.

Outside of Shield wallet, users interacting with DEX contracts require a
programmatic solution for both record management and autojoin. This package
provides a JavaScript autojoin-bot example for programmatic traders. It defaults
to loading a private key from an owner-only file and enabling every supported
autojoin family. A view key is accepted only when every autojoin family is
explicitly disabled for a scan-only run. It registers the derived view key
through the encrypted one-time-key flow, fetches owned records with
`unspent: true`, and verifies their tags against
`/records/tags`. Ciphertext and decrypted-record snapshots are independent,
optional exports and are disabled by default. When enabled, ciphertext
snapshots default to owner-only permissions (which can be relaxed), while
decrypted snapshots are always owner-only.

Before reading records, the client derives the scanner UUID and inspects
`/status`. It reuses a synchronized registration, waits without re-registering
when synchronization is in progress, and registers only when the UUID is
missing. If an owned-record request later reports a missing registration, it
registers once, waits for synchronization, discards partial pages, and restarts
at page zero. Startup polling and its timeout are configured with
`SCAN_SYNC_POLL_INTERVAL_MS` (5 seconds) and `SCAN_SYNC_TIMEOUT_MS` (5 minutes).

The implementation can optionally consolidate ALEO credits records using the
deployed `autojoin_credits_2_10.aleo`, `autojoin_credits_11_14.aleo`, and
`autojoin_credits_15_16.aleo` programs. It authorizes locally, delegates all
proof generation and fee payment, broadcasts through the proving service, and
rescans between batches so a set larger than 16 is reduced safely and
iteratively.

USDCx consolidation is also supported for `usdcx_stablecoin.aleo/Token`
(mainnet) and `test_usdcx_stablecoin.aleo/Token` (testnet), using the
network-specific `aj_usdcx_stablecoin_*` / `aj_test_usdcx_stablecoin_*`
program families.

ARC20 consolidation is supported for `arc20_eth.aleo/Token`,
`arc20_sol.aleo/Token`, and `arc20_wbtc.aleo/Token` on mainnet and the matching
`test_*` token programs on testnet. It calls `main_aj_arc20_2_15.aleo/join_N`
or `test_aj_arc20_2_15.aleo/join_N`, passing the network-specific token program
identifier as the first public input and explicitly loading the dynamically
dispatched token program and its imports before authorization.
