# @provablehq/aleo-bridge-sdk — agent guide

The repo-wide contributor constraints in the root `AGENTS.md` and
`.agents/contributors.md` bind every change in this package.

## Protocol boundary

- USDCx routes MUST use Circle xReserve.
- ETH, WBTC, USDT, SOL, ALEO, and USAD routes MUST use Hyperlane Warp Routes.
- Do not restore the wallet-services provider, quote, order, or cross-chain
  swap abstraction.
- Do not add a dependency from Shield Swap to this package.
- Protocol integrations stay inside this package. Do not change a shared core
  interface to accommodate Circle, EVM, Solana, or Hyperlane.

## Registry

- Discovery reads the injected `BridgeRegistry`; fund-moving logic never
  guesses identifiers or fetches mutable deployment metadata implicitly.
- Pin protocol deployment data to an reviewed upstream version or commit.
- Mark incomplete routes `metadata-required`; do not label them active until
  every contract/program, domain, security module, token, and gas-payment
  identifier needed for execution has been verified.
- Keep wire/protocol-native fields separate from normalized SDK types.

## Execution safety

- `prepareTransfer` remains pure and local.
- Validate route availability, amount precision, recipient encoding, signer
  capability, protocol fees, and required compliance data before the first
  irreversible step.
- Execution plans identify the signer for each transaction and mark the first
  irreversible operation.
- Persist protocol-native identifiers needed to resume: Circle intent and
  attestation identifiers or Hyperlane message ids.
- A timeout does not prove failure; status errors must preserve resumable state.

## Commands

```sh
pnpm --filter @provablehq/aleo-bridge-sdk exec tsc --noEmit
pnpm vitest run packages/bridge
pnpm --filter @provablehq/aleo-bridge-sdk build
```

Protocol integration tests use explicit environment gates. Mainnet tests that
move funds require a separate opt-in beyond read-only or testnet coverage.
