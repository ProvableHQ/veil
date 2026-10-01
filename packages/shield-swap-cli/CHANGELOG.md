# @provablehq/shield-swap-cli

## 0.12.0

### Minor Changes

- Move to the snarkVM 4.11.0 toolchain: `@provablehq/sdk` 0.12.0, `@provablehq/aleo-devnode` 0.3.0, and Leo 4.4.5. The default devnode consensus-heights list now has twenty-two entries and activates every live consensus version at genesis, so a devnode runs V21 (Varuna V3) from its first block; the SDK builds every deployment and execution against the latest Varuna version, and a node still on an earlier version rejects them. `ConsensusVersion::V22` stays a placeholder pinned to `u32::MAX`. A caller who passes an explicit `CONSENSUS_VERSION_HEIGHTS` MUST pass twenty-two heights or the WASM transaction builder panics, and MUST activate V21 by the first block that carries a transaction.

  Peer ranges on `@provablehq/veil-core` and `@provablehq/veil-aleo-devnode` now start at 0.12.0.

### Patch Changes

- Updated dependencies
  - @provablehq/veil-aleo-sdk@0.12.0
  - @provablehq/shield-swap-sdk@0.12.0

## 0.11.1

### Patch Changes

- 3d329de: Resolve claim program imports automatically from on-chain output tokens and simplify examples and agent tooling.
- 3d329de: Add `quote` and `swap({ quote })` for API-estimated single- and multi-hop swaps. Preserve the exact quoted minimum output, validate route/network/freshness, and expose the handoff through agent/MCP tools and the CLI. Keep existing manual swap and `planSwap` calls compatible.

  Make the existing `client.api.confirmAirdrop` also wait for the faucet transaction records when the outer client has a record scanner; retain job-only confirmation without one.

  Accept decimal-string quote inputs in token units, resolving decimals inside quote while retaining bigint raw-unit inputs. The agent/MCP quote tool accepts decimal token amounts and returns raw integer-string quote amounts.

- Updated dependencies [3d329de]
- Updated dependencies [3d329de]
- Updated dependencies [3d329de]
- Updated dependencies [3d329de]
- Updated dependencies [3d329de]
- Updated dependencies [3d329de]
  - @provablehq/shield-swap-sdk@0.11.1
  - @provablehq/veil-aleo-sdk@0.11.1

## 0.11.0

### Patch Changes

- 8b97f14: `createAleoClient` now builds a working client from a private key alone. `networkUrl` is optional and defaults to the new `DEFAULT_NETWORK_URL` (`https://edge.provable.com/api/v2`), matching the existing edge defaults for `proverUrl` and the scanner. `records` defaults to `aleo.createRemoteScanner()` against the hosted scanner instead of leaving `requestRecords` unwired. `useFeeMaster` defaults to `true`, so the delegated prover pays fees for an account holding no public credits; pass `useFeeMaster: false` when the account funds its own fees. The shield-swap CLI drops its legacy Provable API credential wiring (`--consumer-id`, `--api-key`, `ALEO_CONSUMER_ID`, `ALEO_DPS_API_KEY`, and the `provable-credentials.json` file): the gateway needs none, and `setup` removes a legacy pair it finds in an old state file.
- Updated dependencies [8b97f14]
- Updated dependencies [43cd709]
- Updated dependencies [8b97f14]
- Updated dependencies [8b97f14]
  - @provablehq/veil-aleo-sdk@0.11.0
  - @provablehq/shield-swap-sdk@0.11.0

## 0.10.1

### Patch Changes

- caf4425: Default every hosted endpoint to the `edge.provable.com/api` gateway: the delegated prover, the record scanner, the React hook's node URL, and the shield-swap CLI's network URL. The gateway is unauthenticated and needs no consumer or JWT, so a client built from a private key and a network URL proves and scans out of the box; a provisioned key still goes through `auth`. The legacy JWT model stays supported for a caller who points the client at a legacy gateway: with `proverUrl` or the scanner `url` on `https://api.provable.com/...` and a `consumerId` + `apiKey` pair (or a `credentialStore`), a session mints at that gateway's `/jwts` and injects the token. On the default gateway the pair is carried and nothing mints. Consumer registration is retired: `registerProvableApi` is a no-op that resolves `undefined`, `username` is ignored, and a client without a pair never registers one. `authenticateProvableApi` no longer throws on a keyed or credential-less client; it resolves with `registered: false` and, without a pair, no `credentials` and no `expiration`. Bumps `@provablehq/sdk` to 0.11.10, which makes the same default change in the underlying SDK.
- Updated dependencies
- Updated dependencies [caf4425]
  - @provablehq/shield-swap-sdk@0.10.1
  - @provablehq/veil-aleo-sdk@0.10.1

## 0.10.0

### Patch Changes

- 52c63b2: Remove `ApiClient` methods for DEX API routes the server retired: the invite-code
  access routes (`getAccessStatus`, `redeemAccessCode`, `listAccessCodes`,
  `generateAccessCodes`), swap history (`getSwaps`, `getSwap`), the position, token,
  and tick-spacing detail routes (`getPosition`, `getToken`, `getTickSpacings`),
  token registration (`registerToken`), the trading schema routes
  (`getTradingSchemas`, `getTradingSchema`), and public balances
  (`getPublicBalances`, whose `/balances` route was removed earlier).

  Public balances are now read from chain. The new `getPublicBalances` action (also
  `client.getPublicBalances` and the `shield_swap_get_public_balances` agent tool,
  which moves from the API tool set to the chain tool set) reads each AMM token
  program's `balances` mapping for an address and returns raw base units keyed by
  program. `getBalances` composes it with record-derived private balances and no
  longer needs a DEX API credential — only the public token registry.

  Access now goes through the referral endpoints: `getReferralStatus()` reports the
  gate and `redeemReferralCode()` unlocks it. The `shield_swap_get_access_status`
  and `shield_swap_redeem_access_code` agent tools keep their names and are backed
  by those methods. Read a position's live state with the chain-direct `getPosition`
  action, resolve a token from `getTokens()`, take tick spacings from `getFeeTiers()`,
  and recover a wallet-path swap's blinded address from `getSwapOutput().recipient`.

  The `shield-swap setup` command redeems invite codes through the referral endpoint.

- Updated dependencies [ca51d13]
- Updated dependencies [ca51d13]
- Updated dependencies [52c63b2]
  - @provablehq/veil-aleo-sdk@0.10.0
  - @provablehq/shield-swap-sdk@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [7ae571a]
  - @provablehq/shield-swap-sdk@0.9.0
  - @provablehq/veil-aleo-sdk@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [cbb80ef]
  - @provablehq/shield-swap-sdk@0.8.0
  - @provablehq/veil-aleo-sdk@0.8.0

## 0.7.1

### Patch Changes

- Updated dependencies
- Updated dependencies [99defd6]
  - @provablehq/veil-aleo-sdk@0.7.1
  - @provablehq/shield-swap-sdk@0.7.1

## 0.7.0

### Minor Changes

- cda4f20: Move the trader scripts out of `@provablehq/shield-swap-sdk` and into a new
  `@provablehq/shield-swap-cli` package, which installs a `shield-swap` binary.

  The scripts previously shipped as raw TypeScript under `skills/scripts/` and ran
  with `npx tsx` from inside `node_modules`. They are now subcommands —
  `shield-swap setup`, `pools`, `balances`, `positions`, `swap`, `swap-concurrent`,
  `history`, `mint`, `liquidity`, `collect`, `liquidity-e2e` — compiled and
  typechecked like the rest of the workspace. `swap-history` is now `history`; every
  other name is unchanged, as are all flags and the `--execute` and `--json`
  contracts.

  The CLI is a separate install so a project that only needs the client does not
  pull it in: `@provablehq/shield-swap-sdk` no longer ships `skills/scripts/`, and
  its tarball carries only `dist` and the runbook markdown.

  Migrating: install `@provablehq/shield-swap-cli` and replace
  `npx tsx node_modules/@provablehq/shield-swap-sdk/skills/scripts/<name>.ts` with
  `shield-swap <name>` (`npx shield-swap <name>` for a project-local install), and
  import the session helpers from `@provablehq/shield-swap-cli/session` rather than by
  path. Invoke the binary rather than the package: `npx @provablehq/shield-swap-cli`
  resolves against the registry, so the version can change between two commands and
  it needs a network.

### Patch Changes

- Updated dependencies [c2124ee]
- Updated dependencies [cda4f20]
- Updated dependencies [e93d7a3]
- Updated dependencies [e93d7a3]
- Updated dependencies [e93d7a3]
- Updated dependencies [e93d7a3]
- Updated dependencies [e93d7a3]
- Updated dependencies [e93d7a3]
- Updated dependencies [e93d7a3]
- Updated dependencies [cda4f20]
- Updated dependencies [4be5291]
- Updated dependencies [cda4f20]
- Updated dependencies [cda4f20]
- Updated dependencies [cda4f20]
- Updated dependencies [4be5291]
- Updated dependencies [cda4f20]
- Updated dependencies [cda4f20]
- Updated dependencies [c2124ee]
- Updated dependencies [e93d7a3]
- Updated dependencies [e93d7a3]
  - @provablehq/shield-swap-sdk@0.7.0
  - @provablehq/veil-aleo-sdk@0.7.0
