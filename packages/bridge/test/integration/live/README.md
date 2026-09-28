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
