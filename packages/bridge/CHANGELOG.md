# @provablehq/aleo-bridge-sdk

## 0.12.1

### Patch Changes

- @provablehq/veil-core@0.12.1

## 0.12.0

### Minor Changes

- 17a2631: Add Arc mainnet USDC-to-USDCx bridging using the current quote, execute, wait, resume, and complete lifecycle. Align example runners with network-loaded Aleo accounts, optional edge API-key authentication, and explicit preview/execution controls.

  Add native USDC CCTP V2 routes from Ethereum, Base, and Arbitrum to Arc, with Fast/Standard fees, forwarding, and checkpoint recovery. Exhaustive protocol and result switches must handle `cctp` and `evm-cctp`. Add SDK-only Ethereum → Arc → Aleo and Arc → Aleo mainnet tests.

  Use Circle’s version-0 forwarding frame for new CCTP burns, verified with Ethereum-to-Arc mainnet delivery. Preserve recovery of already-submitted version-1 burns.

  Preserve saved pre-Arc plans and checkpoints for unchanged reviewed routes using pinned route fingerprints. Reject unknown versions and altered deployments. Document migration for the expanded protocol, quote, execution, destination-action, and quote-status unions.

  Add a preview-first, checkpointed Base/Arbitrum → Arc → Aleo → Arc → origin example with public USDCx, explicit per-leg execution, received-amount accounting, and documented provider delivery observation limits.

  Harden CCTP recovery with bounded destination-event discovery, stable terminal receipts, and explicit verified approval replacement with retained audit hashes. Normalize CCTP intent and validate route/chain domain agreement. Require explicit xReserve destination domains while preserving legacy Sepolia checkpoint recovery. Keep fee-ceiling defaults unchanged.

- Move to the snarkVM 4.11.0 toolchain: `@provablehq/sdk` 0.12.0, `@provablehq/aleo-devnode` 0.3.0, and Leo 4.4.5. The default devnode consensus-heights list now has twenty-two entries and activates every live consensus version at genesis, so a devnode runs V21 (Varuna V3) from its first block; the SDK builds every deployment and execution against the latest Varuna version, and a node still on an earlier version rejects them. `ConsensusVersion::V22` stays a placeholder pinned to `u32::MAX`. A caller who passes an explicit `CONSENSUS_VERSION_HEIGHTS` MUST pass twenty-two heights or the WASM transaction builder panics, and MUST activate V21 by the first block that carries a transaction.

  Peer ranges on `@provablehq/veil-core` and `@provablehq/veil-aleo-devnode` now start at 0.12.0.

- 8678f0e: Add active BAT, USDG, and ZEC Hyperlane Warp Routes, including classic SPL Token and Token-2022 collateral transfers between Solana and Aleo, reviewed Aleo withdrawal metadata, and ARC-22 privacy wrappers.

  Preserve the existing native Solana metadata and builder parameter types while adding named SPL and combined transfer metadata types.

- 559a3ce: Add optional Privy and Dynamic server-wallet helpers for EVM and Solana bridge clients, with remote signature validation, preserved Solana bridge signatures, and documented configuration examples.

### Patch Changes

- Updated dependencies
  - @provablehq/veil-core@0.12.0

## 0.11.1

### Patch Changes

- 3d329de: Ship runnable bridge examples and an agent guide with resolvable package paths.
- 3d329de: Require Provable SDK 0.11.11 and align devnode transaction building with its 21 consensus versions.
  - @provablehq/veil-core@0.11.1

## 0.11.0

The package now versions in lockstep with the `@provablehq/veil-*` packages
and `@provablehq/shield-swap-sdk`: it jumps from 0.1.1 to 0.11.0 to match
them, and every later release carries the same number across the whole set.
It remains a preview, and its API is still subject to breaking changes
between minor releases.

### Patch Changes

- @provablehq/veil-core@0.11.0

## 0.1.1

### Patch Changes

- Updated dependencies [caf4425]
  - @provablehq/veil-core@0.10.1

## 0.1.0

This is the first release on the bridge SDK's own version line. The package is
versioned independently of the `@provablehq/veil-*` packages from here on and
remains a preview: expect breaking changes between minor releases. It supersedes
the `0.8.0-rc.0` and `0.9.0-rc.1` prereleases, which tracked the Veil version
number.

### Minor Changes

- ca51d13: Replace flat executor and RPC configuration with registry-keyed EVM, Solana,
  and Aleo clients. Add browser-wallet, viem-client, and local-key adapters,
  live Solana fee and rent reads, and expiry-aware confirmation. Every client
  has a public client by default, while wallet actions require the optional
  wallet client explicitly in their signatures. Fund-moving actions expose optional
  compact, versioned checkpoint hooks. Local Aleo flows checkpoint fully proved
  transactions before source or destination broadcast; other wallet APIs
  checkpoint submitted identifiers. Checkpoints exclude private-mint secrets.
  The read-only `recover({ checkpoint })` action returns an explicit `wait`, `resume`,
  `complete`, `done`, or `failed` next step without resubmitting funds. Each bridge decorator action now has its own module,
  with protocol mechanics isolated behind internal helpers. Call builders compute
  wallet inputs without network access and remain standalone utilities rather
  than bridge client methods. Resuming a confirmed xReserve approval now fails
  before another wallet request when its allowance is no longer available.
  Registry discovery is available directly through `registry.getAssets` and
  `registry.getRoutes`.
  The protocol-neutral lifecycle is now `quote`, `execute`, `getStatus`, `wait`,
  `recover`, `resume`, and `complete`. `quote` selects structured source and
  destination assets with an optional `bridgeProtocol` constraint, returns the
  validated plan with live costs, and replaces the separate preparation action.
  `wait` accepts optional stopping statuses, replacing `waitForStatus`. Encoded
  route ids are outputs rather than caller input. Private inbound
  xReserve transfers expose an explicit destination-action state, and `complete`
  submits exactly one caller-authorized Aleo mint. Native Veil wallet clients pass
  directly to `createAleoClient`, while protocol-specific escape hatches remain
  exported under the `hyperlane` and `xreserve` namespaces.
  Quoting and execution dispatch from the prepared route, replacing chain- and
  protocol-specific client methods and the longer transfer-suffixed names.
  Add deterministic recovery journeys and independently gated, minimum-amount
  mainnet suites for xReserve and Hyperlane routes using local accounts.
  Include Solana rent in executable quotes, expose honest Aleo Hyperlane fee
  limits, enforce the xReserve withdrawal fee, and verify Aleo-origin delivery
  from configured destination clients. Hyperlane inbound waits now verify the
  message id against the destination Aleo Mailbox `deliveries` mapping instead
  of treating an explorer index as canonical. Solana submissions align blockhash
  reads and transaction preflight at confirmed commitment, and expiry checks use
  canonical blockhash validity instead of provider-reported block heights. Add proving lifecycle events to core and
  make delegated `writeContract` proving return an unbroadcast transaction for
  the configured Aleo transport to submit. Delegated FeeMaster payment now
  defaults to disabled and must be opted into explicitly.
  Export `DEFAULT_SOLANA_RPC_URL` for the official Solana mainnet endpoint.
  Rewrite every bridge example and the Solana deposit operator script around the
  structured route and recoverable lifecycle APIs, with application-owned optional
  checkpoint persistence and no imports from protocol-internal utilities.
  Use visible minimum transfer amounts and fixed execution defaults in the bridge
  examples, and document the complete lifecycle in a tutorial with runnable route
  commands and recovery guidance.
  Teach client construction, planning, quoting, execution, and recovery beside the
  corresponding example code. The Aleo-to-Ethereum xReserve example now stops at
  the supported source-confirmation boundary instead of attempting unsupported
  destination delivery polling.
  Rewrite bridge action documentation around the caller's cross-chain lifecycle,
  including when funds move, when wallet authorization is required, which calls
  contact networks or providers, and what recovery information applications own.
  Document helper side effects and annotate protocol encodings, authorization
  boundaries, irreversible submissions, provider handoffs, and retry-safe
  recovery behavior for maintainers and independent implementations.
  Revamp every bridge example comment around the caller-visible transfer outcome,
  custody changes, wallet boundaries, settlement authority, and safe recovery after
  an uncertain post-broadcast result. Provider-managed xReserve mint examples now
  stop at the attestation boundary instead of waiting for an unverifiable delivery.

### Patch Changes

- Updated dependencies [ca51d13]
  - @provablehq/veil-core@0.10.0

## 0.9.0-rc.1

### Minor Changes

- 2f473ac: Add injected-wallet execution for Ethereum Hyperlane (ETH/WBTC/USDT) and Circle xReserve (USDC↔USDCx) routes, including Circle attestation helpers and Aleo-side mint/burn actions.
- 734f108: Enable Aleo-origin Hyperlane withdrawals (ETH/WBTC/USDT/SOL): add `quoteAleoHyperlaneGasPayment` for the live interchain gas paymaster quote, accept `gasPaymentMicrocredits` in `transfer_remote` construction and execution, and activate the four reviewed return routes in the default registry.

### Patch Changes

- @provablehq/veil-core@0.9.0

## 0.4.5

### Patch Changes

- @provablehq/veil-core@0.8.0

## 0.4.4

### Patch Changes

- Updated dependencies [99defd6]
  - @provablehq/veil-core@0.7.1

## 0.4.3

### Patch Changes

- Updated dependencies [e93d7a3]
- Updated dependencies [4be5291]
  - @provablehq/veil-core@0.7.0

## 0.4.2

### Patch Changes

- Updated dependencies [387a580]
- Updated dependencies [bc51d70]
- Updated dependencies [bc51d70]
- Updated dependencies [bc51d70]
  - @provablehq/veil-core@0.6.0

## 0.4.1

### Patch Changes

- @provablehq/veil-core@0.4.1
