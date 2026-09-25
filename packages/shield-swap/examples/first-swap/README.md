# First Shield Swap

Create a testnet account, request tokens, trade 1.5 USDCx for ETH, and claim
the output. [swap.ts](./swap.ts) calls the SDK directly in that order.

## Run

Use Node.js 22 or later. From a Veil checkout:

```bash
cd packages/shield-swap/examples/first-swap
npm ci
npm start
```

The example installs published SDK packages; no workspace build is required.
SDK releases containing this example also include the folder at
`node_modules/@provablehq/shield-swap-sdk/examples/first-swap`. Copy it outside
`node_modules` before running it so dependency reinstalls do not remove account
files.

## Account and funding

Set `SHIELD_SWAP_PRIVATE_KEY` to use an existing account. Otherwise the example
generates an account and saves its key to `private-key.txt` with owner-only
permissions. It refuses to overwrite that file. To reuse the generated account:

```bash
export SHIELD_SWAP_PRIVATE_KEY="$(cat private-key.txt)"
```

`createAleoClient` supplies the default prover, fee payment, and record scanner.
`confirmAirdrop` waits for the faucet job; `drop` contains the per-token outcome
or a rate-limit result. The example then waits for enough USDCx to appear in
the account's private balance. One token record must cover the input amount.

`fileBlindedIdentityStore` saves claim information in `<account-address>.json`.
Keep that file and the private key for recovery, and keep both out of source
control. The example adds no other local storage.

## Completion and recovery

`waitForConfirmation` waits for the swap transaction to succeed before the
example submits one claim. Rejection or timeout stops the run before claiming.
A successful run ends after the claim confirms. `handle.transactionId` identifies
the swap; `claim.transactionId` and `claim.amountOut` identify the claim and its
output. The script does not log these values or write a separate result file.

Each run submits a new trade. Do not rerun the whole script to recover an
interrupted swap. Recreate the client with the same key and identity store,
then call `getUnclaimedSwaps()` to find its pending handles. Pass the matching
handle and the token program imports to `claimSwapOutput()`. The SDK recovery
guide describes that sequence; it does not require resubmitting the swap.

An empty pending list can mean the request is still pending or the output was
already claimed. Check transaction status before submitting another trade.
See [SDK recovery](https://shield.fi/docs/sdk/swaps#recover-pending-claims) for
unknown submission states and history reconciliation.

## Check types

```bash
npm run typecheck
```
