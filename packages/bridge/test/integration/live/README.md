# Live bridge tests

These tests use the SDK directly. No bridge CLI is involved.

## Arc mainnet read-only verification

```sh
BRIDGE_ARC_READ_ONLY=1 pnpm vitest run packages/bridge/test/integration/live/mainnet/arc-readonly.live.test.ts
```

This quotes against deployed Arc contracts using public fixture addresses. It
creates no signer and submits no transactions. It does not verify settlement.

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
