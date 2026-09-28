# Your first Shield Swap

[swap.ts](./swap.ts) creates a testnet account, requests test tokens, swaps
**1.5 USDCx for ETH**, and claims the ETH as a private record. It also saves
what is needed to recover a swap if the process stops before claiming.

## Run the example

Use Node.js 22 or later and pnpm 10. From the Veil repository root:

```bash
pnpm setup:first-swap
cd packages/shield-swap/examples/first-swap
npm start
```

The setup command installs dependencies, builds the checkout's SDK packages,
and installs them into this example. It also checks the example's TypeScript.
It does not create an account or submit a transaction; `npm start` does.

This setup is needed while the new actions are unpublished: the example's
pinned npm version, `0.11.0`, does not contain them. The packaging details live
in the setup script, which CI also runs. After changing SDK code, rerun setup
to refresh the example's installed packages.

To use an existing account, set `SHIELD_SWAP_PRIVATE_KEY` before `npm start`.
Otherwise the script generates a key and saves it to `private-key.txt`. Keep
that key and the generated `<account-address>.json` recovery file private.

The example exits successfully after the claim confirms and its output amount
is positive. It currently prints no transaction summary. Each successful run
makes a new trade.

## 1. Load testnet and choose an account

```ts
import { writeFile } from 'node:fs/promises'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const privateKey = process.env.SHIELD_SWAP_PRIVATE_KEY ?? aleo.generateAccount().privateKey

if (!process.env.SHIELD_SWAP_PRIVATE_KEY) {
  await writeFile('private-key.txt', privateKey, { mode: 0o600, flag: 'wx' })
}
```

`loadNetwork('testnet')` loads the SDK for the chosen network. Supplying
`SHIELD_SWAP_PRIVATE_KEY` reuses an account; omitting it generates a new one.
The generated key is written with owner-only permissions. The `wx` flag refuses
to overwrite an existing key, so an accidental rerun cannot replace it.

To reuse a generated account on a later run, from this example's directory:

```bash
export SHIELD_SWAP_PRIVATE_KEY="$(cat private-key.txt)"
```

Reusing an account does not resume a pending trade automatically. See recovery
below before rerunning a script that stopped after submission.

## 2. Create the client and its recovery store

```ts
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'
import { swapFileStore } from '@provablehq/shield-swap-sdk/node'

const { walletClient, account } = aleo.createAleoClient({ privateKey })
const client = walletClient.extend(shieldSwapActions({
  api: {},
  blindedIdentities: swapFileStore(`${account.address}.json`),
}))
```

`createAleoClient` configures the signing account, delegated prover, fee payment,
and record scanner. `extend(shieldSwapActions(...))` adds the DEX actions to that
client, including `quote`, `swap`, and `claimSwapOutput`.

- `api: {}` enables the DEX API with the defaults for testnet. It supplies
  token information, route discovery, output estimates, and the faucet.
- `swapFileStore(...)` saves private swap identities and claim recovery data
  in an account-specific JSON file. Reopening the same file lets a later process
  recover unfinished swaps. Program source code is not stored in the handle.

`swapFileStore` is available from the Node-only `/node` entrypoint because it
writes to the filesystem. The original name, `fileBlindedIdentityStore`, remains
an alias for the same function.

## 3. Authenticate and obtain test tokens

```ts
await client.authenticateShieldSwap()
const drop = await client.api.confirmAirdrop(account.address)
```

Authentication signs the API's challenge with the configured account.
`confirmAirdrop` requests test tokens and waits for the faucet job. Because this
client has a record scanner, it also waits for the transferred records to appear
there, making them available for the swap. No separate record-polling loop is
needed. Without a scanner, the action confirms only the faucet job.

`drop` contains the faucet outcome, including rate limits or per-token results.
An existing funded account can still trade when the faucet is rate-limited;
an account without a USDCx record large enough to cover the input cannot.

## 4. Quote the trade

```ts
const quote = await client.quote({
  from: 'USDCx',
  to: 'ETH',
  amountIn: '1.5',
  slippageBps: 50,
})
```

The amount is a **decimal string in USDCx units**. The SDK looks up the token's
decimals and converts it to raw units. A `bigint` input instead represents raw
units; JavaScript numbers are not accepted because they can lose precision.

The quote uses the indexed API's route and estimated output. `slippageBps: 50`
allows 0.5% slippage, setting the minimum output to 99.5% of that estimate,
rounded down to raw units. Returned amounts such as `quote.expectedOut` and
`quote.minOut` are raw-unit `bigint` values.

Routes can contain one, two, or three hops. Quotes expire after 60 seconds, so
request one shortly before executing it.

## 5. Submit the swap

```ts
const handle = await client.swap({ quote })
```

The action checks the quoted pools on chain, resolves the required program
imports, and selects single-hop or multi-hop execution automatically. It keeps
the quote's exact minimum output.

The returned `handle` identifies this swap, including its transaction ID and
swap ID on this local-account path. The configured store records its recovery
data. Submission is the first phase: the output still needs to be claimed.

## 6. Wait and claim the output

```ts
await client.waitForSwapOutput({ handle })
const claim = await client.claimSwapOutput({ handle })
if (claim.amountOut <= 0n) throw new Error('The claim returned no ETH')
```

`waitForSwapOutput` first confirms the request transaction, then waits for its
on-chain output mapping to become readable. Both stages share a **15-second
polling timeout**, with checks every three seconds. Rejected transactions fail
immediately. The helper only reads state; it never submits a transaction.

If a slower network needs more time, override the timeout in milliseconds:

```ts
await client.waitForSwapOutput({ handle, timeout: 60_000 })
```

`claimSwapOutput` reads the actual amounts from chain, resolves its program
imports automatically, and submits the separate claim transaction. There is
no need to collect imports or copy program sources into the handle. This local
client waits for claim confirmation before returning.

`claim.transactionId` identifies the claim, `claim.amountOut` is the raw amount
received, and `claim.amountRemaining` is any unspent input returned as a refund.
The wrapped ETH output is received as the underlying asset's private record.

## Recover an interrupted swap

A timeout does not mean the swap failed. Do not restart the entire script to
recover a submitted trade: doing so can submit another swap.

Recreate the client with the same private key and `swapFileStore` file, then
inspect its pending swaps:

```ts
const { swaps } = await client.getUnclaimedSwaps()

for (const swap of swaps) {
  if (!swap.claimable || !swap.handle) continue
  const claim = await client.claimSwapOutput({ handle: swap.handle })
  console.log('Recovered claim:', claim.transactionId)
}
```

An empty list can mean the request is still pending or its output was already
claimed. Check transaction status before deciding to submit a new trade. Keep
the private key and recovery file together; never add either to source control.
See the [recovery guide](https://shield.fi/docs/sdk/swaps#recover-pending-claims)
for unknown submission outcomes and history reconciliation.

## Check types without trading

From this example's directory:

```bash
npm run typecheck
```

## Using the example from an installed SDK

SDK releases containing this example include it at
`node_modules/@provablehq/shield-swap-sdk/examples/first-swap`. Copy the folder
outside `node_modules` before running, so dependency reinstalls cannot remove
account files.

For this unreleased version, use the repository setup above. A standalone
`npm ci` requires the example's dependency pins and lockfile to be updated to a
release containing these actions first.
