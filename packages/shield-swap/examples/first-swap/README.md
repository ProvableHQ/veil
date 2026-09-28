# Make a private swap on testnet

This tutorial creates an Aleo account, obtains test tokens, and swaps
**1.5 USDCx for ETH** through Shield Swap. The trade has two transactions:
one requests the swap, and the other claims its output as a private record.
[swap.ts](./swap.ts) contains the complete runnable example.

## Run the example

Install Node.js 22 or later and pnpm 10. From the Veil repository root, run:

```bash
pnpm setup:first-swap
cd packages/shield-swap/examples/first-swap
npm start
```

The setup command installs the SDK and checks the example's TypeScript.
`npm start` runs the trade on testnet. A successful run ends after the claim
confirms and its output amount is positive.

To use an existing account, set `SHIELD_SWAP_PRIVATE_KEY` before starting.
Otherwise the script creates an account and saves its key to `private-key.txt`.
Each run submits a new trade; use the recovery steps below to finish a trade
that was already submitted.

## 1. Load testnet and create an account

Load the testnet SDK, then use the supplied private key or generate an account.
Save a generated key so the same account can be used in a later session.

```ts
import { writeFile } from 'node:fs/promises'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const privateKey = process.env.SHIELD_SWAP_PRIVATE_KEY ?? aleo.generateAccount().privateKey

if (!process.env.SHIELD_SWAP_PRIVATE_KEY) {
  await writeFile('private-key.txt', privateKey, { mode: 0o600, flag: 'wx' })
}
```

To use the saved account, run this command from the example's directory before
starting another session:

```bash
export SHIELD_SWAP_PRIVATE_KEY="$(cat private-key.txt)"
```

## 2. Add swap actions to the client

Create a wallet client with the account's key. The client configures delegated
proving, fee payment, and a record scanner. Extend it with `shieldSwapActions`
to add quoting, swapping, and claiming.

```ts
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'
import { swapFileStore } from '@provablehq/shield-swap-sdk/node'

const { walletClient, account } = aleo.createAleoClient({ privateKey })
const client = walletClient.extend(shieldSwapActions({
  api: {},
  blindedIdentities: swapFileStore(`${account.address}.json`),
}))
```

`api: {}` enables the testnet DEX API for token information, route discovery,
output estimates, and faucet requests.

`swapFileStore` saves the information needed to claim a swap in
`<account-address>.json`. Reuse this file with the same account to recover an
unfinished trade. **Do not commit the private key or recovery file to source
control.**

## 3. Check the balance and request tokens if needed

Authenticate with the DEX API, then check the account's private USDCx balance.
Skip the faucet when the balance covers the trade. Public balances do not count
because this example spends a private token record.

```ts
import { parseUnits } from '@provablehq/shield-swap-sdk'

await client.authenticateShieldSwap()
const amountIn = '1.5'
const from = await client.tokenData('USDCx')
const balances = await client.getBalances({ tokens: [from.id] })

if ((balances[from.id]?.private ?? 0n) < parseUnits(amountIn, from.decimals)) {
  await client.api.confirmAirdrop(account.address)
}
```

Balances are returned in raw units. `parseUnits` converts the decimal amount
using USDCx's decimals so the comparison uses the same units. The quote below
still accepts the decimal string directly.

A private token balance consists of unspent records owned by the account.
The record scanner finds these records so the client can spend them.
`confirmAirdrop` waits for the faucet job and, when a scanner is configured,
for its transferred records to arrive. This client includes a scanner.

The swap needs one USDCx record that covers 1.5 USDCx. A sufficient total split
across smaller records must be consolidated before it can fund this swap.

## 4. Quote 1.5 USDCx for ETH

Request a quote with the input and output token symbols, a decimal amount,
and a slippage allowance.

```ts
const quote = await client.quote({
  from: 'USDCx',
  to: 'ETH',
  amountIn,
  slippageBps: 50,
})
```

`'1.5'` is a decimal string in USDCx units. The SDK looks up the token's decimals
and converts the amount to raw units. A `bigint` input represents raw units
instead. JavaScript numbers are not accepted because they can lose precision.

The quote uses the API's route and estimated output. Fifty basis points allow
0.5% slippage: `quote.minOut` is 99.5% of `quote.expectedOut`, rounded down to
raw units. Both returned amounts are `bigint` values.

A route can pass through one, two, or three pools. Quotes expire after
60 seconds, so submit the swap shortly after requesting a quote.

## 5. Submit the swap

Pass the quote directly to `swap`. The client checks the quoted pools on chain
and executes the selected route while preserving the quote's minimum output.

```ts
const handle = await client.swap({ quote })
```

The returned `handle` identifies the swap and its transaction. The configured
store saves its recovery information. The swap request does not collect the
output; that requires a claim.

## 6. Wait for the result and claim the ETH

Wait for the request transaction to succeed and its output to become readable,
then submit the claim.

```ts
await client.waitForSwapOutput({ handle })
const claim = await client.claimSwapOutput({ handle })
if (claim.amountOut <= 0n) throw new Error('The claim returned no ETH')
```

`waitForSwapOutput` checks every three seconds. Transaction confirmation and
output readiness share a **15-second polling timeout**. A rejected transaction
fails immediately. To allow more time, pass a timeout in milliseconds:

```ts
await client.waitForSwapOutput({ handle, timeout: 60_000 })
```

`claimSwapOutput` reads the actual output amounts from chain and submits the
claim transaction. It resolves the required program imports automatically.
This client waits for claim confirmation before returning.

The claim returns three values:

- `transactionId` identifies the claim transaction.
- `amountOut` is the raw amount of ETH received as a private record.
- `amountRemaining` is any unspent USDCx returned as a refund, in raw units.

## Recover an interrupted swap

A timeout does not prove that a swap failed. **Do not restart the entire script
to recover a submitted trade**; that can submit another swap.

Recreate the client with the same private key and `swapFileStore` file. Find
its unclaimed outputs and claim those with a stored handle:

```ts
const { swaps } = await client.getUnclaimedSwaps()

for (const swap of swaps) {
  if (!swap.claimable || !swap.handle) continue
  const claim = await client.claimSwapOutput({ handle: swap.handle })
  console.log('Recovered claim:', claim.transactionId)
}
```

An empty list can mean the request is still pending or the output was already
claimed. Check transaction status before submitting a new trade. See the
[recovery guide](https://shield.fi/docs/sdk/swaps#recover-pending-claims) for
unknown submission outcomes and history reconciliation.

## Check types without trading

From the example's directory, run:

```bash
npm run typecheck
```
