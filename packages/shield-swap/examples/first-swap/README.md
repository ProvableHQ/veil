# First Shield Swap

Create a testnet account, request tokens, trade 1.5 USDCx for ETH, and claim
the output. [swap.ts](./swap.ts) calls the SDK directly in that order.

## Run

Use Node.js 22 or later. This branch introduces `quote`; the example's pinned
0.11.0 dependency predates that action. Build and install the checkout's package
archives before running the example:

```bash
# From the Veil repository root:
pnpm install --frozen-lockfile
pnpm --filter @provablehq/shield-swap-sdk... --filter @provablehq/veil-aleo-sdk... build
mkdir -p /tmp/veil-first-swap-packages
pnpm --filter @provablehq/veil-core pack --pack-destination /tmp/veil-first-swap-packages
pnpm --filter @provablehq/veil-aleo-sdk pack --pack-destination /tmp/veil-first-swap-packages
pnpm --filter @provablehq/shield-swap-sdk pack --pack-destination /tmp/veil-first-swap-packages
cd packages/shield-swap/examples/first-swap
npm ci
npm install --no-save --package-lock=false /tmp/veil-first-swap-packages/*.tgz
npm start
```

The archives override installed dependencies without changing the example's
lockfile. CI uses the same approach to check the example against this branch.
When the quote-capable SDK is published, update the dependency pins and lockfile
before returning to a standalone `npm ci` workflow.

SDK releases containing this example include the folder at
`node_modules/@provablehq/shield-swap-sdk/examples/first-swap`. Copy it outside
`node_modules` before running so dependency reinstalls do not remove account files.

## Account and funding

Set `SHIELD_SWAP_PRIVATE_KEY` to use an existing account. Otherwise the example
generates an account and saves its key to `private-key.txt` with owner-only
permissions. It refuses to overwrite that file. To reuse the generated account:

```bash
export SHIELD_SWAP_PRIVATE_KEY="$(cat private-key.txt)"
```

`createAleoClient` supplies the default prover, fee payment, and record scanner.
`confirmAirdrop` waits for the faucet job and its records to arrive in the
configured scanner; `drop` contains the per-token outcome or a rate-limit
result. Without a scanner it confirms only the faucet job. Rejected or failed
token transfers remain visible in `drop.job.results`. One token record must
cover the input amount.

`swapFileStore` saves claim information in `<account-address>.json`.
Keep that file and the private key for recovery, and keep both out of source
control. The example adds no other local storage.

## Quote and swap

`client.quote` trusts the API's route and output estimate, converts the estimate
to raw units, and calculates a 0.5% minimum output. The input `'1.5'` is a decimal
string in USDCx units; quote resolves its decimals automatically. Bigint inputs
remain raw base units. `client.swap({ quote })`
checks the route pools on chain and executes one, two or three hops automatically.
It preserves the exact quoted minimum. Quotes expire after 60 seconds; a missing
estimate or zero floor fails before submission.

## Completion and recovery

`waitForSwapOutput({ handle })` confirms the swap transaction and waits for its
output mapping to become readable, sharing a 15-second polling timeout.
The example then submits one claim. Rejection or timeout stops the run before claiming.
A successful run ends after the claim confirms. `handle.transactionId` identifies
the swap; `claim.transactionId` and `claim.amountOut` identify the claim and its
output. The script does not log these values or write a separate result file.

Each run submits a new trade. Do not rerun the whole script to recover an
interrupted swap. Recreate the client with the same key and identity store,
then call `getUnclaimedSwaps()` to find its pending handles. Pass the matching
handle to `claimSwapOutput()`; it resolves the required program imports from chain. The SDK recovery
guide describes that sequence; it does not require resubmitting the swap.

An empty pending list can mean the request is still pending or the output was
already claimed. Check transaction status before submitting another trade.
See [SDK recovery](https://shield.fi/docs/sdk/swaps#recover-pending-claims) for
unknown submission states and history reconciliation.

## Check types

```bash
npm run typecheck
```
