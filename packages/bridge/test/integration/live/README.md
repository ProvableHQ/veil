# Live bridge tests

These tests use the SDK directly. No bridge CLI is involved.

## Arc mainnet read-only verification

```sh
BRIDGE_ARC_READ_ONLY=1 pnpm vitest run packages/bridge/test/integration/live/mainnet/arc-readonly.live.test.ts
```

This quotes against deployed Arc contracts using public fixture addresses. It
creates no signer and submits no transactions. It does not verify settlement. The same read-only suite verifies CCTP domains
and remote messengers for Arc → Ethereum/Base/Arbitrum, checks destination USDC
decimals, and fetches live Standard forwarding quotes for all three routes.
These outbound CCTP checks do not submit transfers.

## Arc mainnet deposit and private mint

Set `BRIDGE_EVM_PRIVATE_KEY` to an Arc-funded test account and
`BRIDGE_PRIVATE_KEY` to an Aleo test account with public credits for fees.
`EDGE_PROVABLE_API_KEY` is optional. `BRIDGE_LIVE_ARC_RPC_URL` optionally
overrides `https://rpc.mainnet.arc.io`.

```sh
BRIDGE_LIVE_FUNDS=1 \
BRIDGE_LIVE_MAINNET_ACK=I_ACKNOWLEDGE_BRIDGE_MAINNET_FUNDS \
BRIDGE_LIVE_MAINNET_CASES=arc-xreserve \
BRIDGE_LIVE_STATE_DIR=/absolute/persistent/state/directory \
pnpm vitest run packages/bridge/test/integration/live/mainnet/evm-xreserve.live.test.ts
```

Without `BRIDGE_LIVE_MAINNET_EXECUTE`, the test quotes the 2-USDC deposit and
stops before submission. Set that variable to
`I_ACKNOWLEDGE_THIS_SUBMITS_MAINNET_TRANSACTIONS` to execute approval/deposit,
recover through a public-only client, wait for attestation, and privately mint
on Aleo. Arc requires USDC for both the deposit and native gas.

Progress is persisted to `mainnet/arc-xreserve-recovery.json` beneath the state
directory. Reuse it after timeout; do not delete it to retry a submitted deposit.
The Ethereum case remains `evm-xreserve` with its own recovery file.

### Ethereum → Arc → Aleo

Select `BRIDGE_LIVE_MAINNET_CASES=ethereum-arc-aleo` with the existing mainnet
acknowledgements. The SDK first transfers 5 native USDC from Ethereum to Arc
using CCTP Fast Transfer and forwarding, capped at 0.25 USDC in protocol and
forwarding fees, then privately mints 2 USDCx on Aleo through xReserve.
The remaining Arc USDC funds the separate `arc-xreserve` case (another 2 USDC)
and Arc gas. Run those cases sequentially with the same persistent state
directory. Each leg recovers its own saved checkpoint before any new submission.
Ethereum gas and the Aleo proving fee are additional.

Without the transaction acknowledgement, the journey only quotes the first
leg. A successful quote is not proof of end-to-end delivery.

For a saved, attested CCTP burn whose forwarding stalls, fund the test signer
with Arc gas and set `BRIDGE_LIVE_CCTP_MANUAL_MINT=1` alongside the execution
acknowledgement. The SDK manually mints that existing message before proceeding;
it does not submit another Ethereum burn. This validates manual recovery, not
successful Circle forwarding.

The Ethereum live-test signer sets an explicit 1-gwei priority fee per transaction.
A chain-level default alone can be bypassed by RPC transaction filling.

## Aleo private USDCx → Arc USDC

Use the same mainnet acknowledgement variables with
`BRIDGE_LIVE_MAINNET_CASES=aleo-arc` and run
`packages/bridge/test/integration/live/mainnet/aleo-arc.live.test.ts`.
The test spends one unspent 2-USDCx record plus the Aleo proving fee. It derives
fresh freeze-list proofs, checks the live fee estimate against a 0.10-USDC
budget at quote and execution, and persists checkpoints to `mainnet/aleo-arc.json`.
The deployed burn has no on-chain fee cap; actual provider fees may change.

Set `BRIDGE_LIVE_ARC_RECIPIENT` to the receiving address, or supply
`BRIDGE_EVM_PRIVATE_KEY` only to derive that address. No Arc transaction is
signed. The test verifies Aleo acceptance, an Arc USDC transfer event, and the
recipient's exact balance increase. Keep this recipient idle during the test
so unrelated transactions cannot invalidate the balance check. Timing and both
transaction IDs are persisted. Restart with the same state file after errors;
never delete a checkpoint to retry a burn.

## Arc CCTP roundtrips

Run `mainnet/cctp-roundtrip.live.test.ts` with the usual mainnet acknowledgements
and any of `cctp-roundtrip-ethereum`, `cctp-roundtrip-base`, or
`cctp-roundtrip-arbitrum` in `BRIDGE_LIVE_MAINNET_CASES`. The test sends Arc USDC
out and returns only the attested net amount received. Both legs use forwarding
and verify the exact mint plus recipient balance increase through the SDK.

The Ethereum outbound fee cap is 2.70 USDC; execution still tightens the fee to
the live quote plus 5% and 0.001 USDC, within that cap.
The configured outbound amounts are 2.75 USDC for Ethereum and 0.25 USDC each
for Base and Arbitrum. Every new leg chooses a ceiling close to the live fee
estimate, within the scenario's absolute budget. Forwarding may spend the full
ceiling; budget headroom is not promised as a refund. The wallet needs USDC for
Arc gas and native ETH on the other chain for its return approval/burn. Gas
funding is a separate, explicitly authorized operation; these tests do not fund
other chains automatically.

Each leg keeps its own `mainnet/cctp-roundtrip-<chain>-outbound.json` or
`-return.json` checkpoint, transaction IDs, delivered amount, and elapsed time.
Reuse those files after an interruption. Completed legs are reverified rather
than repeated, and submitted legs remain recoverable without fresh gas. Keep
the recipient idle during each roundtrip so unrelated transfers cannot distort
the exact balance assertions.

## PR #169: BAT, USDG, and ZEC

Run mainnet reads without keys or transaction submission:

```sh
BRIDGE_ARC22_READ_ONLY=1 pnpm vitest run \
  packages/bridge/test/integration/live/mainnet/arc22-hyperlane.live.test.ts
```

This runs 16 real-network checks: ten directional quotes, two Ethereum collateral
checks, three Solana mint/program/escrow checks, and recovery of the historical
ZEC Solana deposit in the PR fixture through canonical Aleo Mailbox delivery.
It does not create a new transfer. HTTP/RPC failures fail the checks; there is no
mock or silent fallback. Public endpoints can rate-limit; override
`BRIDGE_LIVE_ETHEREUM_RPC_URL`, `BRIDGE_LIVE_SOLANA_RPC_URL`, or `ALEO_RPC_URL`.

The same file has ten independently selectable fund-moving cases. Select exactly
one route and configure its source key using the
[example instructions](../../../examples/README.md#bat-usdg-and-zec-live-quotes-transfers-and-recovery).
Amounts are explicit, never inferred from a wallet balance. For example:

```sh
export BRIDGE_LIVE_FUNDS=1
export BRIDGE_LIVE_MAINNET_ACK=I_ACKNOWLEDGE_BRIDGE_MAINNET_FUNDS
export BRIDGE_LIVE_MAINNET_CASES=arc22-hyperlane
export BRIDGE_LIVE_STATE_DIR='/absolute/private/path/bridge-live'
export BRIDGE_ARC22_ROUTE_ID='hyperlane:solana/zec->aleo/zec'
export BRIDGE_ARC22_AMOUNT='0.0001'
export BRIDGE_ARC22_SENDER='<source address>'
export BRIDGE_ARC22_RECIPIENT='<destination address>'
BRIDGE_LIVE_MAINNET_EXECUTE=I_ACKNOWLEDGE_THIS_SUBMITS_MAINNET_TRANSACTIONS \
  pnpm vitest run packages/bridge/test/integration/live/mainnet/arc22-hyperlane.live.test.ts
```

Only the selected transfer runs; the other nine are skipped. Without the execution
acknowledgement all ten are skipped, so a quote-only run cannot be mistaken for a
passing end-to-end transfer test.
State filenames are route-specific, and restart uses the saved checkpoint instead
of repeating the transfer. Delivery, not source acceptance, is the pass condition.

Validation on 2026-10-01 against PR head `ac7f718` plus these tests: **16 read-only
live checks passed**, including historical ZEC recovery. **No new fund-moving
transfer was run**; the ten new execution cases were skipped. The original PR's
reported 403 passing tests/16 skipped live tests is distinct from this validation.
