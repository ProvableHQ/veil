---
sidebar_position: 8
---

# Integrating Shield Swap

Shield Swap is the concentrated-liquidity AMM on Aleo, deployed as
`shield_swap_v3.aleo`. Trading on it differs from trading on an EVM DEX in
one structural way: swaps are private, so a swap is two transactions rather
than one. The first submits the request; when it finalizes, the chain
computes the actual output and stores it in a mapping under a swap id. The
second transaction claims that output, which lands in the trader's account
as private records — Aleo's encrypted spendable notes, analogous to UTXOs.
Until the claim runs, the output is not spendable.

`@provablehq/shield-swap-sdk` wraps this lifecycle in typed methods on a
Veil client and handles the parts that are easy to get wrong: deriving the
single-use blinded identity a private swap is claimed with, selecting the
records a swap spends, and sequencing the two-phase claim. This guide walks
the full integration with a local private key — the setup for a bot, script,
or server — and notes where the connected-wallet path differs. Each step
links to the corresponding [`/api/shield-swap`](/api/shield-swap/swap)
reference page for complete parameters, return shapes, and errors.

## Set up a client

Chain reads need only a transport. Writes need three more things: an account
that can sign, a proving configuration (delegated below, or fully local),
and a record scanner so the client can find the unspent private records that
swaps and mints spend.

[`createAleoClient`](/api/provable-sdk/createAleoClient) wires all of that
in one call — it derives the account from the private key, builds the
transport, and constructs the proving config internally. Extending the
result with `shieldSwapActions` adds the DEX methods.

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const aleo = await loadNetwork('testnet')

const scanner = aleo.createRemoteScanner({
  url: 'https://edge.provable.com/api/scanner',
})

const { walletClient } = aleo.createAleoClient({
  privateKey: PRIVATE_KEY,
  networkUrl: 'https://edge.provable.com/api/v2',
  provingMode: 'delegated',
  proverUrl: 'https://edge.provable.com/api/prove',
  records: scanner,
})

const client = walletClient.extend(
  shieldSwapActions({ api: {} }),
)
```

Delegated proving and the hosted scanner run on the Provable gateway, which
needs no credentials. See
[`createRemoteScanner`](/api/provable-sdk/createRemoteScanner) for the
scanner's registration behavior.

To use a different contract or API deployment, pass
`shieldSwapActions({ program, api: { baseUrl } })`.

In a browser dApp, the connected wallet replaces all of this configuration:
it holds the keys and records and proves on the user's behalf, so the app
carries no private key, proving config, or scanner. Build the client from
the wallet adapter's account and transport instead — the wallet-account
examples on [`swap`](/api/shield-swap/swap) show the connect-time setup,
including the `SHIELD_SWAP_ALGORITHM_GRANTS` the wallet needs to derive
blinded identities.

## The Shield Swap API

The Shield Swap API is an HTTP service for discovering pools and tokens,
finding swap routes, and reading indexed trading data. It supplies information
that an application would otherwise need to collect from chain history or
calculate with its own route finder. Veil uses this service for pool discovery
and quotes.

The API works alongside Aleo nodes. Nodes provide live contract state and
transaction results; the API provides discovery and trade estimates. The client
uses each through the following methods:

| Method | Source | Purpose |
| --- | --- | --- |
| `client.api.getPools()`, `client.api.getTokens()` | Shield Swap API | Discover available pools and token metadata. |
| `client.quote()` | Shield Swap API | Find a route and estimate its output; calculate a minimum output from the chosen slippage tolerance. |
| `client.getPool()`, `client.getSlot()` | Aleo node | Read the pool's configuration and current trading state. |
| `client.swap()` | Aleo node and prover | Validate the quoted route's pools and submit the swap transaction. |
| `client.waitForSwapOutput()`, `client.claimSwapOutput()` | Aleo node; a prover for the claim | Read the finalized output, then submit a transaction to collect it. |

API endpoint methods live under `client.api`. Higher-level methods can use those
endpoints internally: `client.quote()` calls the API's route endpoint. The
quote's output is an estimate; the swap transaction enforces its minimum output
against the pool state at execution. Read the actual proceeds from the chain
before claiming them.

Pool and token discovery, fee-tier reads, and public market data need no login.
Route quotes and account-specific data require authentication. Direct chain
reads such as `client.getSlot()` work without API credentials.

### Authenticate the account

Authentication signs an API challenge to prove control of the account, without
submitting a transaction or paying a network fee. Using the client configured
above:

```ts
await client.authenticateShieldSwap()
```

The client retains the session credential and attaches it to requests that need
it. By default, if an authenticated request returns 401 for an expired session,
the retained signer authenticates again and the client retries that request
once. A failed renewal is returned to the caller.

### Enable access with an invite code

An authenticated account also needs Shield Swap access to request routes and
other restricted data. Check whether the account already has access before
redeeming an invite code:

```ts
if (!(await client.api.getReferralStatus()).has_access) {
  const inviteCode = process.env.SHIELD_SWAP_INVITE_CODE
  if (!inviteCode) throw new Error('Set SHIELD_SWAP_INVITE_CODE for this account')
  await client.api.redeemReferralCode(inviteCode)
}
```

Redemption records access on the server and takes effect for the current
session. An account without access receives a 403 response from restricted
endpoints even after authenticating. Returning accounts can reuse their existing
access without redeeming another code.

### Use an API token for a service

A bot or server can reuse a long-lived API token instead of signing a challenge
on every startup. Create the token once from an authenticated session:

```ts
const { token } = await client.api.createApiToken({ name: 'trading-bot' })
// Save token in the application's secret store; its full value is shown only once.
```

On subsequent runs, load that saved value and pass it to the action decorator:

```ts
const apiToken = process.env.SHIELD_SWAP_API_TOKEN
if (!apiToken) throw new Error('Set SHIELD_SWAP_API_TOKEN')

const bot = walletClient.extend(shieldSwapActions({ api: { apiToken } }))
```

The token authenticates API requests. On-chain swaps still require the account
to sign and prove their transactions. Token management (`createApiToken`,
`listApiTokens`, and `revokeApiToken`) requires a session obtained by signing;
an API token cannot manage other tokens.

## Discover existing pools and available tokens

Use the Shield Swap API to find a pool. Each entry includes a pool key, the
identifier passed to reads and swaps, and the ids of its two tokens. Aleo
represents these ids as integers followed by `field`. Token metadata describes
the symbols, decimal places, and programs used by each asset.

```ts
const { data: pools } = await client.api.getPools()
const pool = pools[0]
if (!pool) throw new Error('No pools are available')

pool.key                          // '4719…field'
pool.token0                       // token id, a field literal
pool.token0_info?.decimals
pool.token0_info?.amm_token_program // Program used by the pool for this token.
```

`amm_token_program` identifies the token program used by the pool. Wrapped
assets also name an `underlying_program`, which holds the account's spendable
records. Token metadata can be absent from a pool response; fetch the token
list to inspect the available symbols and ids:

```ts
const tokens = await client.listTokens()
console.table(tokens.map((token) => ({
  symbol: token.symbol, id: token.id, decimals: token.decimals,
})))
```

After choosing a pool, read its current state from the node.
[`getPool`](/api/shield-swap/getPool) returns its configuration, including the
token pair and fee tier. [`getSlot`](/api/shield-swap/getSlot) returns the price
and liquidity state used by trades:

```ts
const config = await client.getPool({ poolKey: pool.key })
const slot = await client.getSlot({ poolKey: pool.key })
```

## Quote, then swap

A swap exchanges one token for another using funds in a liquidity pool. This
example spends 1.5 USDCx to receive ETH. The amount of ETH depends on the pool's
price and available liquidity when the transaction executes.

Get a quote first to inspect the estimated return and set the lowest acceptable
output. The [Shield Swap API](#the-shield-swap-api) finds a path between the
tokens and estimates what the trade will receive. Requesting a quote reads data;
it does not sign a transaction, spend tokens, or reserve the pool's liquidity.

### Request and inspect a quote

Use the authenticated client from the API setup above. `amountIn: '1.5'` means
1.5 USDCx. `slippageBps: 50` allows an output up to 0.5% below the estimate,
subject to integer rounding. A basis point is one hundredth of a percent.
This tolerance determines the minimum output enforced by the swap contract:

```ts
import { formatUnits } from '@provablehq/shield-swap-sdk'

const quote = await client.quote({
  from: 'USDCx',
  to: 'ETH',
  amountIn: '1.5',
  slippageBps: 50,
})
console.log('Estimated ETH:', formatUnits(quote.expectedOut, quote.to.decimals))
console.log('Minimum ETH:', formatUnits(quote.minOut, quote.to.decimals))
```

The displayed amounts are decimal token amounts. Inside the returned quote,
amounts use `bigint` counts of the token's smallest unit, called a **base unit**.
For a token with six decimal places, 1.5 tokens equals 1,500,000 base units.
`formatUnits` converts that integer back to a display value using the token's
`decimals` metadata.

For `amountIn`, a decimal string such as `'1.5'` is usually the clearest choice.
A `bigint` input means base units: `1_500_000n` means 1.5 tokens only when that
token has six decimal places. The SDK rejects JavaScript number inputs and
excess decimal precision instead of silently rounding them.

The quote also includes its **route**, the sequence of pools used to exchange
the input token for the output token. Each pool crossed is called a **hop**:

| Route | What happens |
| --- | --- |
| One hop | One pool exchanges the input token directly for the output token. |
| Two hops | The first pool exchanges the input for an intermediate token; the second exchanges that token for the output. |
| Three hops | Three pools perform the exchange through two intermediate tokens. |

`quote.hops` lists those pools in order. `client.swap({ quote })` chooses the
single-pool or multi-pool execution automatically. The minimum output applies
to the final token received. Intermediate tokens do not require separate claims.

The estimate comes from the API's indexed data; quoting does not read live pool
state from an Aleo node. Prices can change before execution. Each quote expires
60 seconds after the request starts, and a missing estimate or a minimum output
that rounds to zero causes quoting to fail.

### Submit the quoted trade

After reviewing the estimate and minimum, pass the quote to `swap` without
changing its fields. This call signs, proves, and submits a transaction that
spends the input token. Request a fresh quote if the previous one has expired:

```ts
const handle = await client.swap({ quote })
console.log('Swap transaction:', handle.transactionId)
```

Before submission, the SDK checks the quoted pools on chain, verifies that the
quote matches the client's network, and preserves `quote.minOut` exactly.
If the contract cannot satisfy that minimum at execution, the transaction is
rejected.

With the local signer configured in this guide, the client selects an unspent
private record holding at least 1.5 USDCx. A record is an individually spendable
token balance; several smaller records do not automatically fund this call.
Use [record management](./record-inventory.md#join-only-enough-for-a-spend) to
join them first if needed, then obtain a fresh quote.

The returned **handle** holds the swap transaction id and the information needed
to claim its output. Retain it until the trade is finished. A service that must
recover after a restart should configure the [persistent identity store](#configure-a-shared-client)
before submitting swaps so handles are saved with their claim identities.

Connected wallets additionally require an explicit `tokenRecord`, supplied as
a wallet record request or granted plaintext. Their handles can require fields
to be recovered from the confirmed transaction before claiming; the
[`swap` reference](/api/shield-swap/swap) documents that wallet flow.

Shield Swap uses two transactions so it can calculate the trade against current
pool state first, then prove and pay the resulting amount privately. The swap
stores the result for a single-use blinded address, an address derived for
this trade. A separate claim proves control of that address and collects the
proceeds as private records.

## Finalize a swap

Finish the trade by claiming its confirmed output. Until the claim succeeds,
the proceeds remain in the contract's `swap_outputs` mapping, an on-chain table
indexed by swap id. They are not yet records that the account can spend.

### Wait for the result, then claim it

Continue with the `handle` and `quote` from the previous section.
`waitForSwapOutput` checks transaction confirmation and waits until the node
can return the stored result. It only reads the chain. Once that result is
available, `claimSwapOutput` submits the second transaction:

```ts
await client.waitForSwapOutput({
  handle,
  timeout: 600_000,
  pollingInterval: 3_000,
})

const claimed = await client.claimSwapOutput({ handle })
console.log('Claim transaction:', claimed.transactionId)
console.log('ETH received:', formatUnits(claimed.amountOut, quote.to.decimals))
console.log('USDCx refunded:', formatUnits(claimed.amountRemaining, quote.from.decimals))
```

This waits up to ten minutes for the result, polling every three seconds.
The claim reads the actual amounts from chain, proves ownership of the blinded
address, and creates the private output records. With a local signer, it waits
for the claim transaction to confirm before returning.

`amountOut` is the output token received. `amountRemaining` is the unspent input
returned alongside it when the trade stops at its price limit. For example, a
trade offering 1.5 USDCx that spends 1.2 USDCx refunds 0.3 USDCx in the same claim.
A fully filled trade returns `0n` for `amountRemaining` and creates no refund
record. If a token uses an AMM wrapper, claiming returns records of the underlying
asset.

To inspect the stored result without waiting or claiming, call
[`client.getSwapOutput({ swapId, program })`](/api/shield-swap/getSwapOutput).
It returns the output and refund amounts, or `null` when the entry is absent.

### Recover an unfinished claim

A missing result can mean the swap has not finalized yet, or that its output
was already claimed. Use the transaction history and saved handle to distinguish
those cases:

| Outcome | Next action |
| --- | --- |
| `waitForSwapOutput` times out | Keep the handle and check the original transaction. A timeout does not prove failure; do not submit a replacement swap. |
| `claimSwapOutput` throws `SwapOutputNotFinalizedError` | Check whether the swap is still pending or a claim already succeeded. A successful claim removes the mapping entry. |
| Claim submission or confirmation fails | Resolve that claim's transaction status before attempting another claim. Retain the handle and recovery stores. |

The [recovery walkthrough](#selection-failures-and-recovery) shows how to check
the journal and find outstanding claims after a restart.

For a connected wallet, fill any missing `handle.swapId` and
`handle.blindedAddress` before claiming. The confirmed swap transaction exposes
the swap id; the stored output's `recipient` identifies the blinded address.
The wallet derives the claim proof from that address without exposing the
blinding factor to the application. See
[`claimSwapOutput`](/api/shield-swap/claimSwapOutput) for the wallet-specific
fields and confirmation behavior.

## Concurrent swaps

This walkthrough prepares six private USDCx records, submits six swaps for ETH,
and claims their outputs. A record holds an individually spendable amount of a
token. Spending it consumes that record, so each simultaneous swap needs a
different input even when the account has enough total USDCx.

Each swap also uses a blinded identity: a temporary address derived from the
account's key that receives the swap's proceeds. A separate claim transaction
collects those proceeds as private records. The setup below saves both the
record reservations and the identity information needed to finish claims after
a restart.

### Configure a shared client

This Node example uses a funded testnet account with Shield Swap access. Install
`@provablehq/shield-swap-cli` alongside the SDK packages to use its optional
SQLite storage adapter; it requires Node 22.13 or newer. The SDK itself does not
require SQLite. For a different storage backend, supply a
[`RecordInventoryStore`](./record-inventory.md#share-a-store-and-retain-it-across-restarts).
Run only one trader process for the account with the bundled identity store.
SQLite can coordinate record reservations across processes, but the identity
store allocates its counters within one process. Two processes opening the same
`blinded.json` can allocate the same identity.

For several clients in one process, pass the same `store` and `identities`
objects to each client and use the same `chainId`. Several processes require
separate coordination of identity allocation or distinct explicit identities;
sharing the two file paths alone is insufficient.

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { shieldSwapActions, parseUnits } from '@provablehq/shield-swap-sdk'
import { swapFileStore } from '@provablehq/shield-swap-sdk/node'
import { sqliteRecordInventoryStore } from '@provablehq/shield-swap-cli/storage'

const privateKey = process.env.ALEO_PRIVATE_KEY
if (!privateKey) throw new Error('Set ALEO_PRIVATE_KEY')
const aleo = await loadNetwork('testnet')
const address = aleo.privateKeyToAccount(privateKey).address
const directory = `.veil/testnet/${address}`
const store = await sqliteRecordInventoryStore(`${directory}/inventory.sqlite`)
const identities = swapFileStore(`${directory}/blinded.json`)
const { walletClient } = aleo.createAleoClient({
  privateKey,
  records: aleo.createRemoteScanner({ waitForSync: true }),
  provingMode: 'delegated', useFeeMaster: true, confirmationTimeout: 600_000,
  recordManagement: { enabled: true, store, chainId: 'aleo:testnet' },
})
const client = walletClient.extend(shieldSwapActions({
  api: {}, blindedIdentities: identities,
}))
await client.authenticateShieldSwap()
```

`recordManagement.enabled` opts into reservations and recovery; attaching
`shieldSwapActions()` alone leaves them disabled. `store` records spent inputs
and prepared transactions. `identities` stores blinded addresses and swap handles
for claims. Keep both files private and reuse them after restarting. This setup
uses FeeMaster for network fees; managed private-fee selection is described in
the [record management guide](./record-inventory.md#private-fees).

### Prepare one record per trade

Reconcile earlier work before planning. Six swaps of 0.1 USDCx need at least
six available records holding 0.1 USDCx each. A single 0.6 USDCx record cannot
fund all six at once. Preparing a balanced inventory can join and split the
account's entire available USDCx balance; reserved records are excluded.

```ts
const journal = await client.reconcileRecordInventory()
if (journal.some((entry) => !['confirmed', 'rejected', 'cancelled'].includes(entry.status))) {
  throw new Error('Resolve pending transactions before starting another batch')
}
const pending = await client.getUnclaimedSwaps()
if (pending.swaps.length || pending.unresolvable.length) {
  throw new Error('Recover previous swaps before starting another batch')
}
const token = await client.tokenData('USDCx')
const plan = await client.planInventory({
  token: token.id,
  target: {
    records: 6, minRecordAmount: parseUnits('0.1', token.decimals),
    distribution: 'balanced', toleranceBps: 0,
  },
  maxTransactions: 24,
})
console.table(plan.steps) // Inspect the joins and splits before execution.
```

Planning makes no reservation and submits nothing. After reviewing `plan.steps`,
execute that same plan with `client.rebalanceRecordInventory({ plan })`.
`client.rebalanceInventory({ token, target })` instead creates a fresh plan at
call time. If preparation is interrupted, stop before submitting any swaps.

### Submit swaps and claim their outputs

The following calls spend funds. A new quote is fetched after maintenance so
the time spent joining and splitting does not consume its 60-second lifetime.
All six swaps use the same terms and independently select their input records.
A successful `swap` call returns a **handle** containing the transaction and
claim information. `waitForSwapOutput` waits for the on-chain result;
`claimSwapOutput` submits the transaction that collects it.

```ts
const maintenance = await client.rebalanceRecordInventory({
  plan, timeoutMs: 600_000, pollIntervalMs: 3_000,
})
if (maintenance.status !== 'complete') {
  throw new Error(`Inventory preparation interrupted: ${maintenance.reason}`)
}

// Fetch a fresh quote after the maintenance transactions have finished.
const quote = await client.quote({ from: 'USDCx', to: 'ETH', amountIn: '0.1', slippageBps: 50 })
const swaps = await Promise.allSettled(
  Array.from({ length: 6 }, () => client.swap({ quote })),
)
const handles = swaps.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])

// Attempt every successful swap's claim even when another trade failed.
const claims = await Promise.allSettled(handles.map(async (handle) => {
  await client.waitForSwapOutput({ handle, timeout: 600_000, pollingInterval: 3_000 })
  return client.claimSwapOutput({ handle })
}))
console.log('Swap results:', swaps.map((result) => result.status))
console.table(claims.map((result, index) => ({
  swap: handles[index]!.transactionId,
  status: result.status,
  amountOut: result.status === 'fulfilled' ? result.value.amountOut.toString() : undefined,
  refund: result.status === 'fulfilled' ? result.value.amountRemaining.toString() : undefined,
})))
// Retain both stores after failures. Close SQLite after all calls have settled.
store.close()
```

### Selection, failures, and recovery

The six calls above can finish with different outcomes. Follow the input
selection first, then inspect each swap and claim before starting another batch.

#### 1. Follow two swaps competing for an input

Consider two swaps selling 0.1 USDCx each, with two available records holding
0.1 USDCx apiece. Both calls can read the same scanner result before either has
reserved a record. A reservation marks a record as in use in the shared store,
so another participating call cannot spend it.

One possible ordering is:

```text
Swap A                         Shared record store                 Swap B
  |                                    |                             |
  |--- reserve record 1 --------------->|                             |
  |<-- acquired -----------------------|<--- reserve record 1 --------|
  |                                    |---- already reserved ------>|
  |                                    |<--- reserve record 2 --------|
  |                                    |---- acquired -------------->|
  |                                    |                             |
  +--- prove and submit                |          prove and submit ---+
```

This selection happens automatically for local `swap` and `swapMultiHop` calls
when record management is enabled and `tokenRecord` is omitted:

1. Scan once for unreserved records large enough to cover the input amount,
   ordered from smallest to largest.
2. Try to reserve the first candidate. If another call acquired it first, try
   the next candidate. Each record nonce, which identifies a record, is tried
   at most once.
3. Prove and submit after acquiring an input. If every candidate is taken, fail
   before proving. The call does not wait for a deposit or join smaller records.

Choosing record 2 leaves the trade unchanged: the input amount, minimum output,
blinded identity, and swap nonce remain fixed. Before trying another record,
the client checks that the quote has not expired and the account and network
still match. Proving, submission, and confirmation errors do not restart this
selection loop.

An explicit `tokenRecord` fixes the input, so a reservation conflict fails that
call. Wallet accounts require a pinned record supplied by the caller; automatic
reselection applies to local signers.

#### 2. Inspect swaps and claims separately

Each call is a separate transaction. A quote reserves no pool liquidity, so one
trade can change the price seen by the next. Each trade still enforces its own
minimum output. If one fails, other swaps in the batch can succeed.

For example, a six-swap batch could leave this work:

| Result | Next action |
| --- | --- |
| Swaps 1 through 4 and their claims succeed | Record the received amounts. These trades are finished. |
| Swap 5 fails before proving because no input is available | Inspect the inventory before planning another trade. |
| Swap 6 succeeds, but waiting for its output times out | Retain its handle and recover that swap. Do not submit swap 6 again. |

`Promise.allSettled` retains each result even when another call fails. Inspect
both arrays from the submission example; `claims[index]` corresponds to
`handles[index]`, not necessarily `swaps[index]`, because failed swaps have no
returned handle:

```ts
for (const [index, result] of swaps.entries()) {
  if (result.status === 'rejected') {
    console.error(`Swap ${index + 1} needs inspection:`, result.reason)
  }
}
for (const [index, result] of claims.entries()) {
  if (result.status === 'rejected') {
    console.error('Unfinished claim:', handles[index]!.transactionId, result.reason)
  }
}
```

A successful claim can return both ETH and unspent USDCx. `amountOut` is the ETH
received; `amountRemaining` is the USDCx refund, each in its token's base units.
For example, if a 0.1 USDCx trade spends only 0.08 USDCx at the price limit, the
same claim collects its ETH proceeds and refunds the remaining 0.02 USDCx.

#### 3. Recover the existing batch after a restart

A timeout means the client stopped waiting; the transaction may still reach the
chain. Keep `inventory.sqlite` and `blinded.json`. Repeat
[Configure a shared client](#configure-a-shared-client) with the same account,
network, and paths, then run the recovery code below **instead of submitting
another batch**. Stop other traders for that account while recovering.

First, check the saved transactions against the chain. The journal records both
swaps and claims, so an uncertain claim must also be resolved before claiming
again:

```ts
const recoveryJournal = await client.reconcileRecordInventory()
const unresolved = recoveryJournal.filter((entry) =>
  !['confirmed', 'rejected', 'cancelled'].includes(entry.status),
)
console.table(unresolved.map((entry) => ({
  transaction: entry.transactionId, status: entry.status,
})))
if (unresolved.length) {
  throw new Error('Resolve these transactions before retrying claims or swaps')
}
```

Reconciliation does not submit anything by default. If a saved transaction needs
to be sent again, follow [Recover interrupted work](./record-inventory.md#recover-interrupted-work)
to rebroadcast that exact transaction. A missing confirmation does not release
its records.

Once transaction outcomes are known, find outputs that still need claiming.
`getUnclaimedSwaps()` checks the identities in `blinded.json` against the chain
and returns saved handles for outputs that remain available:

```ts
const unclaimed = await client.getUnclaimedSwaps()
if (unclaimed.unresolvable.length || unclaimed.swaps.some((swap) => !swap.handle)) {
  throw new Error('Restore missing swap information before automatic recovery')
}

// These calls collect existing outputs; they do not submit replacement swaps.
const recoveredClaims = await Promise.allSettled(unclaimed.swaps.map(async (swap) => {
  await client.waitForSwapOutput({ handle: swap.handle!, timeout: 600_000 })
  return client.claimSwapOutput({ handle: swap.handle! })
}))
for (const [index, result] of recoveredClaims.entries()) {
  if (result.status === 'rejected') {
    console.error('Claim still needs recovery:', unclaimed.swaps[index]!.swapId, result.reason)
  }
}
store.close() // Close only after all recovery calls have settled.
```

An identity without saved swap information needs inspection of the original
transaction; the lookup cannot reconstruct every lost response. Keep both stores
until all transactions and claims are accounted for. Resolve failed claim
attempts before submitting another batch.

The runnable [concurrent-swaps.ts](https://github.com/ProvableHQ/veil/blob/main/examples/shield-swap/concurrent-swaps.ts)
adds a preview mode, a pending-batch marker, and a lock file that prevents
overlapping runs against its directory. Its
[README](https://github.com/ProvableHQ/veil/blob/main/examples/shield-swap/README.md)
covers commands and recovery. The CLI's `swap-concurrent` command allows only
one trade per input token in a batch; use the SDK example for several simultaneous
USDCx sales. See [record management](./record-inventory.md) for storage options,
fee limits, wallet requirements, and join helpers.

## Liquidity

Positions are concentrated-liquidity ranges, held as private records.
[`createPool`](/api/shield-swap/createPool) opens a pair at a fee tier —
a single public transaction, identical on both signer paths.
[`mint`](/api/shield-swap/mint) opens a position over a tick range; ticks
round to the pool's tick spacing automatically, and the range is fixed at
mint. Mint and [`increaseLiquidity`](/api/shield-swap/increaseLiquidity)
both spend token records, so they split by signer the same way `swap` does:
a local key auto-selects records, a wallet supplies them as `record`
`InputRequest`s.

```ts
const slot = await client.getSlot({ poolKey: pool.key })
if (!slot) throw new Error('Pool state is unavailable')

// Load sources for both pool tokens and any underlying assets used by the mint.
const poolTokens = await Promise.all([
  client.tokenData(pool.token0), client.tokenData(pool.token1),
])
if (poolTokens.some((token) => !token.ammTokenProgram)) {
  throw new Error('Token program metadata is unavailable')
}
const tokenPrograms = poolTokens
  .flatMap((token) => [token.ammTokenProgram, token.underlyingProgram])
  .filter((program): program is string => program !== undefined)

const { positionTokenId } = await client.mint({
  poolKey: pool.key,
  recipient: walletClient.account!.address,
  withdrawal: walletClient.account!.address,
  tickLower: slot.tick - slot.tick_spacing * 10,
  tickUpper: slot.tick + slot.tick_spacing * 10,
  amount0Desired: 10n ** 18n,
  amount1Desired: 2_000_000n,
  imports: await client.resolveDexImports({ tokenPrograms }),
})
```

Unwinding a position runs in three steps:
[`decreaseLiquidity`](/api/shield-swap/decreaseLiquidity) burns liquidity
and accrues the withdrawn amounts as owed;
[`collect`](/api/shield-swap/collect) sweeps owed tokens back as private
records; [`burn`](/api/shield-swap/burn) closes the emptied position. Each
mirrors the funding entry points' local-versus-wallet split.

## Read-only access

Pool state and DEX API queries need neither a key nor proving nor a scanner
— a `PublicClient` over a transport is enough. This is the setup for price
feeds, dashboards, and any consumer that only reads.

```ts
import { createPublicClient, http } from '@provablehq/veil-core'
import { shieldSwapActions } from '@provablehq/shield-swap-sdk'

const client = createPublicClient({
  transport: http('https://edge.provable.com/api/v2', { network: 'testnet' }),
}).extend(shieldSwapActions({ api: {} }))

const pool = await client.getPool({ poolKey })  // static config: token pair, fee, decimals
const slot = await client.getSlot({ poolKey })  // live state: price, tick, liquidity
```

## Balances

Private balances are not an account field on chain — they are the sum of the
caller's unspent records, which only the caller's view key can decrypt. The
SDK offers three views:

```ts
// Private — summed from the caller's unspent records (spendable privately).
await client.getPrivateBalances({ programs: ['ethx_5a095e.aleo'] })
// { 'ethx_5a095e.aleo': 3000000000000000000n }

// Public — each AMM token program's on-chain `balances` mapping, for any address.
await client.getPublicBalances({ user: address, programs: ['test_arc20_eth.aleo'] })
// { 'test_arc20_eth.aleo': 5000000000000000000n }

// Combined — public + private + total per token, keyed by token id. The API's
// token registry supplies the program list; both balance sides come from chain.
await client.getBalances()
// { '1223…045field': { symbol: 'ETHx', decimals: 18, public: 5n, private: 3n, total: 8n }, … }
```

`getBalances` composes the other two: it pulls the token registry from the
API (so no program list is needed), reads public balances, sums the caller's
private records, and joins them per token. It defaults to the client's own
account address and, unless given a `tokens` filter, returns only tokens the
account actually holds.

## Units and formats

- Token amounts are raw atomic units, typed `bigint` (u128). Ticks and fees
  fit in `number`.
- Fees are in pips (`3000` = 0.30%). Slippage is in basis points
  (`50` = 0.5%).
- Pool keys and token ids are Aleo field literals including the suffix,
  e.g. `'4719…field'`.
- Fields read from chain keep their wire names (`amount_out`,
  `tick_spacing`).

The [`/api/shield-swap`](/api/shield-swap/swap) reference pages document
every action's parameters, return shape, and errors, with both signer paths
per action; the [package page](/packages/shield-swap) covers installation
and the agent/MCP subpaths.
