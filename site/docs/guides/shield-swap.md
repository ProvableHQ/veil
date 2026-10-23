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

The composed client has two surfaces, split by provenance. Chain-direct
reads and writes sit flat on the client (`client.getPool`, `client.swap`) —
these values come from the node and gate money movement. The off-chain DEX
API is namespaced under `client.api` (`client.api.getPools`), so a call site
always shows which world a value came from. Both default to
`shield_swap_v3.aleo` and the Provable API; override either with
`shieldSwapActions({ program, api: { baseUrl } })`.

In a browser dApp, the connected wallet replaces all of this configuration:
it holds the keys and records and proves on the user's behalf, so the app
carries no private key, proving config, or scanner. Build the client from
the wallet adapter's account and transport instead — the wallet-account
examples on [`swap`](/api/shield-swap/swap) show the connect-time setup,
including the `SHIELD_SWAP_ALGORITHM_GRANTS` the wallet needs to derive
blinded identities.

## Authenticating with the DEX API

Most DEX API endpoints beyond pool and token discovery — routes, swaps,
positions, balances, fee tiers, candles — require a bearer credential. The
account signs a challenge once per session:

```ts
await client.authenticateShieldSwap()
const route = await client.api.getRoute({ token_in, token_out })
```

The session lasts about 24 hours and renews itself: the signer is retained,
so an expired session re-authenticates and retries on the next gated call.

A process that should not sign on every boot — a bot, CI, a server — mints a
long-lived API token (`ss_…`) once and passes it at construction instead:

```ts
// One-time provisioning; the secret is shown only once.
await client.authenticateShieldSwap()
const { token } = await client.api.createApiToken({ name: 'trading-bot' })

// Every run after that — no handshake, no signer needed for API reads.
const bot = walletClient.extend(shieldSwapActions({ api: { apiToken: token } }))
```

Managing tokens (`createApiToken`, `listApiTokens`, `revokeApiToken`) always
requires a fresh session JWT; the tokens themselves cover data and trading
endpoints only.

Authentication is the first of two gates. The account must also have
redeemed a referral code (the invite codes Shield Swap distributes), or gated
endpoints return 403 `redeem an invite code to unlock access`:

```ts
await client.authenticateShieldSwap()
if (!(await client.api.getReferralStatus()).has_access) {
  await client.api.redeemReferralCode(inviteCode) // one-time per account
}
```

Redemption unlocks the session immediately — the grant is recorded
server-side, no second handshake needed.

## Pools and tokens

Pool discovery goes through the DEX API. Each entry carries the pool key —
an Aleo field literal that every read and swap takes — plus metadata for
both tokens.

```ts
const { data: pools } = await client.api.getPools()
const pool = pools[0]

pool.key                          // '4719…field'
pool.token0                       // token id, a field literal
pool.token0_info.decimals
pool.token0_info.wrapper_program  // e.g. 'ethx_5a095e.aleo'
```

The `wrapper_program` matters: private token balances live as records inside
each token's wrapper program, so the swap and mint calls need to know which
program to look in.

On-chain state comes in two parts. [`getPool`](/api/shield-swap/getPool)
returns static configuration — token pair, fee tier, decimal scales — and
[`getSlot`](/api/shield-swap/getSlot) returns live trading state: the
current sqrt price, active tick, and in-range liquidity.

```ts
const config = await client.getPool({ poolKey: pool.key })
const slot = await client.getSlot({ poolKey: pool.key })
```

## Program imports

`shield_swap` calls token programs through a dynamic dispatch interface, so
the prover cannot discover them by static analysis. Every write takes an
`imports` map of program id to program source for the tokens involved. Fetch
the sources once and reuse them across calls:

```ts
import { getProgram } from '@provablehq/veil-core'

const imports = {
  [pool.token0_info.wrapper_program]: await getProgram(walletClient, { programId: pool.token0_info.wrapper_program }),
  [pool.token1_info.wrapper_program]: await getProgram(walletClient, { programId: pool.token1_info.wrapper_program }),
}
```

## Quote, then swap

`client.quote` resolves a 1–3-hop route and trusts the DEX API's output estimate.
It converts the estimate to raw base units without floating-point rounding and
calculates a minimum output. No pool or tick reads occur while quoting.

```ts
const quote = await client.quote({
  from: 'USDCx',
  to: 'ETH',
  amountIn: '1.5', // token units; bigint inputs use raw base units
  slippageBps: 50,
})
```

The quote expires after 60 seconds. `swap({ quote })` checks its route pools on
chain and submits exactly `quote.minOut`. Missing estimates and zero floors
reject; request a new quote when one expires. Quotes do not reserve liquidity.

[`swap`](/api/shield-swap/swap) submits the request — phase one. On the
local-signer path the client auto-selects an unspent record covering
`amountIn` from the token's wrapper program and derives the single-use claim
identity from the account's view key. It returns a `SwapHandle`, a plain
serializable object that is the key to claiming the output. Persist it if
there is any chance the process dies before the claim.

```ts
const handle = await client.swap({ quote })
// Wallet accounts additionally pass tokenRecord.
```

A wallet never exposes its records, so the wallet path drops
`tokenInProgram` and passes `tokenRecord` as a `record` `InputRequest`
instead — the wallet resolves it against its own records and fills the
blinding slots itself. The handle then comes back without `swapId` or
`blindedAddress`; the wallet-account section of
[`swap`](/api/shield-swap/swap) shows the exact shape.

## Claim the output

Claiming — phase two — reads the chain-computed output from the
`swap_outputs` mapping and collects it as private records.
[`claimSwapOutput`](/api/shield-swap/claimSwapOutput) throws
`SwapOutputNotFinalizedError` when the request transaction has not finalized
yet; retry after a few blocks. The same error after a successful claim means
the output was already collected — claiming consumes the on-chain entry.

```ts
import { SwapOutputNotFinalizedError } from '@provablehq/shield-swap-sdk'

let claimed
for (let i = 0; i < 20; i++) {
  try {
    claimed = await client.claimSwapOutput({ handle, imports })
    break
  } catch (err) {
    if (!(err instanceof SwapOutputNotFinalizedError)) throw err
    await new Promise((r) => setTimeout(r, 3_000))
  }
}

console.log(`received ${claimed!.amountOut}, refunded ${claimed!.amountRemaining}`)
```

Claims are mandatory: a swap's tokens are not the trader's until claimed.
`amountRemaining` is non-zero when the swap partially filled at the price
limit — the unspent input comes back in the same claim. To inspect the
chain-computed result without claiming, read it directly with
[`getSwapOutput`](/api/shield-swap/getSwapOutput).

On the wallet path the handle needs `swapId` and `blindedAddress` set before
claiming — recover them from the confirmed request transaction (the swap id
is the transition's first public output; the blinded address is the
`recipient` of the chain's `swap_outputs` entry, read with
[`getSwapOutput`](/api/shield-swap/getSwapOutput)). The wallet re-derives the
blinding factor from the blinded address, so the dApp never holds it. See
[`claimSwapOutput`](/api/shield-swap/claimSwapOutput) for the full recovery
flow.

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

const { positionTokenId } = await client.mint({
  poolKey: pool.key,
  tickLower: slot.tick - slot.tick_spacing * 10,
  tickUpper: slot.tick + slot.tick_spacing * 10,
  amount0Desired: 10n ** 18n,
  amount1Desired: 2_000_000n,
  token0Program: pool.token0_info.wrapper_program,
  token1Program: pool.token1_info.wrapper_program,
  imports,
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
