---
'@provablehq/veil-aleo-sdk': minor
'@provablehq/shield-swap-cli': patch
---

`createAleoClient` now builds a working client from a private key alone. `networkUrl` is optional and defaults to the new `DEFAULT_NETWORK_URL` (`https://edge.provable.com/api/v2`), matching the existing edge defaults for `proverUrl` and the scanner. `records` defaults to `aleo.createRemoteScanner()` against the hosted scanner instead of leaving `requestRecords` unwired. `useFeeMaster` defaults to `true`, so the delegated prover pays fees for an account holding no public credits; pass `useFeeMaster: false` when the account funds its own fees. The shield-swap CLI drops its legacy Provable API credential wiring (`--consumer-id`, `--api-key`, `ALEO_CONSUMER_ID`, `ALEO_DPS_API_KEY`, and the `provable-credentials.json` file): the gateway needs none, and `setup` removes a legacy pair it finds in an old state file.
