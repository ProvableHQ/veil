# Private testnet ETH mint and withdrawal

[`testnet-eth.ts`](./testnet-eth.ts) runs Sepolia ETH → a private Aleo testnet
ETH record, then a private ETH withdrawal → public Sepolia ETH. It uses
`@provablehq/aleo-bridge-sdk` and `@provablehq/veil-aleo-sdk` with local keys.
No Shield extension, wallet adapter, or Wallet Services API is needed.

The flow follows the toolkit's
[`feat/hyperlane-private-bridge-example` example at 463c16a](https://github.com/ProvableHQ/aleo-dev-toolkit/tree/463c16a0a0b9a93e7aac678146518a5d5e9d7876/examples/hyperlane-bridge).
Its wallet requests an address encoding and resolves `route-bound-commitment-secret`.
This CLI instead creates a random local scalar, computes the same BHP256 address
commitment, and retains the scalar in the local state file for `bridge.complete`.
It MUST keep that file; the wallet's encoding history cannot restore this identity.

## Deployment and registry

[`testnet-eth-registry.ts`](./testnet-eth-registry.ts) supplies a complete,
testnet-only `BridgeRegistry`, replacing the default catalog for this example:

| Setting | Value |
| --- | --- |
| Sepolia chain/domain | `11155111` |
| Aleo testnet domain | `1617853565` |
| Sepolia native ETH router | `0x7c4aAAaB1f846881af95f5736d127F3F3F07F25F` |
| Aleo warp | `test_hyp_warp_token_eth_v2.aleo` |
| Private token record | `test_arc20_eth.aleo/Token` |
| Mailbox | `test_hyp_mailbox.aleo` |
| Hook manager | `test_hyp_hook_manager.aleo` |
| Compliance program | `shield_arc22_freezelist.aleo` |
| Private fee mapping | `private_transfer_fee_bps__[false]` |

The router is pinned to Hyperlane registry commit
`418056e21734d26a7d14692e0ec5e902cc9e86bf`. App metadata, enrolled Sepolia
router, mailbox hooks, and the deployed five-input `claim_private` and
eleven-input `transfer_remote_private` ABI were read on 2026-11-24.
The registry contains the warp source's SHA-256 fingerprint. The CLI checks
the source before proceeding and rejects a changed deployment. It also checks
the Sepolia RPC chain id and Aleo mailbox domain. Private withdrawal execution
rechecks live app metadata, enrollment, hooks, fees, and outbound pause state
through the SDK. Inbound execution explicitly checks the directional
`bridge_pause[true]` array in addition to the generic route pause probe.
Deployment changes require reviewing and updating this example's snapshot;
the script never silently adopts new deployment metadata. The package's default
registry and mainnet routes are unchanged.

## Configure and quote

From the repository root, install and build the workspace dependencies with
`pnpm install` and `pnpm build`. The existing [example installation instructions](./README.md#install-and-configure)
also apply when copying the shipped examples into another project.

Set a funded Aleo testnet account. The private key is held in this process:

```sh
read -rs ALEO_PRIVATE_KEY && export ALEO_PRIVATE_KEY
export SEPOLIA_RPC_URL='https://ethereum-sepolia-rpc.publicnode.com'
export ALEO_RPC_URL='https://edge.provable.com/api/v2'
pnpm exec tsx packages/bridge/examples/testnet-eth.ts mint 0.001
```

`ALEO_RPC_URL` is a base URL; the SDK appends `/testnet`. A normal invocation
quotes only: no transaction is signed or submitted. It creates
`.veil/testnet-eth-mint.json` with mode `0600`, containing the original local
claim identity. The state directory is ignored by Git. Quotes display the full
Sepolia transaction value, including the principal and Hyperlane fee; Sepolia
execution gas is additional.

`ALEO_PROVING_MODE` defaults to `delegated`; `local` enables local proving.
`ALEO_PROVER_URL` and optional gateway authentication follow the other bridge
examples. FeeMaster is disabled: the Aleo account needs public testnet credits
for claim and withdrawal execution fees.

## Mint privately

Set the private key for a funded Sepolia account, then opt into testnet execution:

```sh
read -rs EVM_PRIVATE_KEY && export EVM_PRIVATE_KEY
export EXECUTE_BRIDGE=I_UNDERSTAND_THIS_MOVES_TESTNET_FUNDS
pnpm exec tsx packages/bridge/examples/testnet-eth.ts mint 0.001
```

The script reuses the saved encoding, quotes and executes the Sepolia
`transferRemote`, waits for the warp's `claimable` mapping to be funded,
generates a recipient exclusion proof against the current freezelist root,
then calls `bridge.complete` to execute `claim_private`. The resulting private
record belongs to `ALEO_PRIVATE_KEY`. The secret scalar never enters a public
bridge checkpoint or console output. The state file stores it separately.

If the source transfer succeeds but the claim needs another invocation:

```sh
pnpm exec tsx packages/bridge/examples/testnet-eth.ts claim
```

This recovers the saved transfer and authorizes only the funded claim. It does
not send Sepolia ETH again. Unset `EXECUTE_BRIDGE` to inspect readiness without
authorizing a claim.

## Withdraw private ETH

Select a nonzero Sepolia recipient and inspect the private quote:

```sh
unset EXECUTE_BRIDGE
export SEPOLIA_RECIPIENT='0x...'
pnpm exec tsx packages/bridge/examples/testnet-eth.ts withdraw 0.0005
```

The amount is the **gross private ETH spend**. The displayed token fee is
deducted from it; the net amount arrives as public Sepolia ETH. The SDK's
private quote prices both dispatch hooks separately from Aleo execution fees.

The Aleo account needs one unspent ETH `Token` record covering the gross spend
and one private `credits` record covering the dispatch payment. The SDK selects
records through the hosted scanner and generates the signer exclusion proof.
An indexer delay or fragmented records can prevent selection; wait for indexing
or consolidate records in the wallet before attempting a fresh withdrawal.
Public credits fund execution separately. No unshield transaction is required.

```sh
export EXECUTE_BRIDGE=I_UNDERSTAND_THIS_MOVES_TESTNET_FUNDS
pnpm exec tsx packages/bridge/examples/testnet-eth.ts withdraw 0.0005
```

Execution passes `hyperlanePrivateTransfer: { quote }` to `bridge.execute`,
which builds the eleven-input `transfer_remote_private` call. The script saves
the prepared transaction before broadcast and the submitted id afterward. It
waits for source confirmation and the recipient's expected net Sepolia balance
increase. Keep that recipient idle during observation so unrelated balance
changes cannot be mistaken for delivery.

## Recover and start another transfer

A timeout or RPC error does not establish failure. Retain the original keys,
state file, and amount. Rerunning a submitted transfer observes its saved
checkpoint instead of executing it again. Recovery never signs:

```sh
pnpm exec tsx packages/bridge/examples/testnet-eth.ts recover
BRIDGE_STATE_FILE=.veil/testnet-eth-withdraw.json pnpm exec tsx packages/bridge/examples/testnet-eth.ts recover
```

An immutable prepared withdrawal may require explicit resumption:

```sh
BRIDGE_STATE_FILE=.veil/testnet-eth-withdraw.json pnpm exec tsx packages/bridge/examples/testnet-eth.ts resume
```

`resume` requires the execution acknowledgement and broadcasts the saved
prepared transaction through `bridge.resume`. It does not select new records or
rebuild the withdrawal. If a submission was attempted without a saved id, or a
claim submission outcome is unknown without saved proved bytes, inspect chain/account history before
retrying; the script refuses another submission. If the CLI is forcibly killed,
remove its `.lock` file only after confirming no process still uses the state.
A leftover `.tmp` file likewise requires inspection before removal.

Local claim checkpoints keep the encrypted proved bytes after broadcast until
the transaction is accepted or rejected. If a broadcast claim disappears from
the node, `claim` rebroadcasts those exact bytes without a new secret or proof.
Private withdrawal hook fees must match the reviewed quote exactly, even after
a downward oracle update. A changed quote can stop local proving or prevent
resumption; review a new attempt only after establishing that the old one was
never broadcast.

For a **new** transfer, choose a new `BRIDGE_STATE_FILE`. Do not delete an
unresolved transfer's state or reuse a funded commitment to start another mint.
The mint and withdrawal use separate default state files.
