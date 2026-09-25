# First Shield Swap

Create an account, request test tokens, trade 1.5 USDCx for ETH, and claim the output. This standalone example uses published Veil 0.11.0 packages and runs only on testnet. No Veil checkout or Shield Swap CLI is required.

## Run

Use Node.js 22 or later. The checkout location is
`packages/shield-swap/examples/first-swap` in the Veil repository.

```bash
git clone https://github.com/ProvableHQ/veil.git
cd veil/packages/shield-swap/examples/first-swap
npm ci
npm start
```

For an existing Veil checkout, start from the example directory and run
`npm ci` followed by `npm start`. This folder installs its own published
SDK dependencies; no monorepo build is required.

`npm start` requests faucet tokens and submits one testnet swap and its claim. The faucet and proofs can take several minutes. A successful run exits with code zero and writes `.state/<address>/result.json` with the swap and claim transaction ids, received ETH, and any USDCx refund. The example does not log to the console. Errors exit nonzero.

If invited access is required, obtain an issued code and run:

```bash
npm start -- --invite-code <code>
```

The account is saved before authentication, so this resumes setup with the same account. An invite code is redeemed only when the account lacks access.

## Installed package

SDK releases include this folder at
`node_modules/@provablehq/shield-swap-sdk/examples/first-swap`. Copy the folder
outside `node_modules` before running it so account state survives dependency
reinstalls:

```bash
cp -R node_modules/@provablehq/shield-swap-sdk/examples/first-swap ./shield-first-swap
cd shield-first-swap
npm ci
npm start
```

## Account and configuration

With no configuration, the example generates an account and saves its key in `.state/account.json` with owner-only permissions. Later runs reuse that account. To use an existing account, set `SHIELD_SWAP_PRIVATE_KEY` in the invoking shell. That key takes precedence over the saved account and is not written to the account file.

`SHIELD_SWAP_PRIVATE_KEY` is the only environment variable read by the example. Network, amount, pair, and slippage are explicit in [swap.ts](./swap.ts). The Aleo client uses its default gateway, delegated prover, fee payment, and record scanner. Shield Swap authentication uses the account's signature.

Keep `.state/` private and retain it until all pending outputs have been claimed. It is excluded from source control; the runner also writes an ignore file inside the state directory for copies made from an installed package. Each account has its own confidential-address store, submission marker, faucet result, and claim result.

## Funding and recovery

`client.api.confirmAirdrop()` waits for the faucet job. The example saves the per-token result and waits for the scanner to report enough private balance. If the faucet rate-limits an already funded account or a USDCx transfer fails, the balance check still runs. A funding timeout reports the USDCx faucet status. The SDK selects a single token record that covers the input amount; an account containing only smaller records may need record consolidation before trading.

The example records submission intent before calling `swap` or `swapMultiHop`. Once that marker exists, `npm start` refuses to submit another swap, even if the previous process failed. Recover a confirmed swap's output with:

```bash
npm run claim
```

This command reads pending outputs from chain and claims handles retained in the confidential-address store. It does not request an airdrop or submit a swap. If it finds no claimable output, inspect the transaction status: the request may still be pending, may have failed, or may already have been claimed. An absent output alone does not prove success. Preserve the state and follow the [SDK recovery guide](https://shield.fi/docs/sdk/swaps#recover-pending-claims) when the stored handle is incomplete or submission status is unknown.

Run one process per account. A hard process termination can leave `.state/<address>/run.lock`; remove that lock only after confirming the earlier process has stopped. Keep `submission.json` and `identities.json`. Deleting submission state and rerunning can create another trade.

After a successful run, inspect `result.json` rather than rerunning to check success. To intentionally execute another independent example, use another testnet account through `SHIELD_SWAP_PRIVATE_KEY`.

## Verify

```bash
npm run typecheck
npm test
```

The offline tests check account reuse, file permissions, protection against damaged state, and duplicate-submission prevention. `npm start` is the live end-to-end check: it must finish the claim and receive a positive output amount before exiting successfully.
