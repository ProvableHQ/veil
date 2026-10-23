---
title: Record management
description: Configure private record inventory, shared reservations, fee selection, and recovery in Veil.
---

# Record management

This guide shows how to inspect private balances, prepare records for upcoming
transactions, and recover unfinished work in Veil. The examples use a local
signer on testnet. Connected wallets can also use record management when they
provide the [required record information](#interrupted-work-and-wallets).

Aleo holds private tokens in **records**, each containing an individually
spendable amount. Spending a record consumes it; any change arrives in a new
record. An account's private balance is the sum of its unspent records, much
like a Bitcoin wallet's unspent outputs.

A Shield Swap trade needs one record large enough for its input. Two trades
running at once need different records. These hypothetical USDCx inventories
all total 1 USDCx, but support different trades:

| Available records | One 1 USDCx swap | Two simultaneous 0.5 USDCx swaps |
| --- | --- | --- |
| One record holding 1 USDCx | Ready | Split the record first. |
| Two records holding 0.5 USDCx each | Join the records first. | Ready |
| Records holding 0.4 and 0.6 USDCx | Join the records first. | Redistribute the amounts first. |

A **join** consumes several records and produces one larger record. A **split**
consumes one record and produces two smaller ones. Both are on-chain
transactions. Veil can plan these operations before submitting them.

Record management also reserves inputs while a transaction is in progress.
A reservation tells other clients sharing the store that a record is already
in use. The store's **journal** tracks those reservations and transaction
outcomes, so unfinished work can be checked after an interruption.

## Enable record coordination

Start with a client that can sign transactions and read the account's records.
This example reads an existing testnet key from `ALEO_PRIVATE_KEY`; it does not
create or fund an account. The remote scanner finds unspent records, while the
inventory store tracks which of those records are in use by this application.

Wallet clients already include the inventory methods. Reservations and recovery
are **off by default**, including after `.extend(recordActions())` or
`.extend(shieldSwapActions())`. Set `recordManagement.enabled` when creating the
client to enable them:

```ts
import { memoryRecordInventoryStore } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const privateKey = process.env.ALEO_PRIVATE_KEY
if (!privateKey) throw new Error('Set ALEO_PRIVATE_KEY')

const aleo = await loadNetwork('testnet')
const store = memoryRecordInventoryStore()
const { walletClient: client } = aleo.createAleoClient({
  privateKey,
  records: aleo.createRemoteScanner({ waitForSync: true }),
  recordManagement: { enabled: true, store, chainId: 'aleo:testnet' },
})

// Read the available balance without signing or submitting a transaction.
const inventory = await client.getRecordInventory({ asset: { program: 'credits.aleo' } })
console.log('Available microcredits:', inventory.balance.toString())
console.log('Available records:', inventory.available.length)
console.log('Reserved records:', inventory.reserved.length)
```

`inventory.available` contains records that can be selected now;
`inventory.reserved` contains records held by journal entries, including spent
inputs still reported by the scanner. `inventory.balance` sums only the
available records. Reading this inventory does not reserve them.

The example keeps its journal in memory. Follow the [storage setup](#share-a-store-and-retain-it-across-restarts)
below before submitting transactions that must remain recoverable after a
restart. Journals store record identifiers and transaction progress, not private
keys or decrypted record contents.

`createClient`, `createWalletClient`, `aleo.createAleoClient`, and
`createDevnodeClient` accept `recordManagement`. Core provides the interfaces
without requiring Node, a database, or a particular wallet. The Aleo SDK supplies
the scanner and local or delegated prover. A connected wallet supplies its own
records and proving; see [wallet requirements](#interrupted-work-and-wallets).

### Configuration and defaults

| Setting | Default | When to set it |
| --- | --- | --- |
| `enabled` | Disabled when `recordManagement` is omitted | Set `true` to reserve inputs and retain transaction checkpoints. It does not start background maintenance. |
| `store` | A separate `memoryRecordInventoryStore()` for each enabled client when omitted | Configurable through any `RecordInventoryStore` implementation, including the optional SQLite adapter or a custom backend. Share one store across clients using the same inventory. See [storage setup](#share-a-store-and-retain-it-across-restarts) for persistence and recovery. |
| `chainId` | The transport's network | Use the same identity for participants on one chain. Give each custom or local chain a distinct identity. Required if the transport has no network. |
| `maxFeeMicrocredits` | No limit | Bound the total network fee of each transaction before broadcast. Requires a local signer and a prover that supports checkpoints. |
| `tokenJoin` | Helpers selected by asset and network | Set `false` for native pairwise joins, or configure a reviewed dynamic ARC helper. See [batch joins](#batch-joins). |

With `enabled: false`, no journal is created and fee limits are ignored. Chain
identity and join-routing options can still affect read-only plans and explicit
joins. Enabling coordination does not automatically join records during a swap,
split balances, or launch a worker. Call the maintenance methods when needed.

Configure record management before attaching action decorators. Rebuild the
client when changing networks; an in-progress operation checks that its account
and chain remain unchanged. Clients sharing reservations MUST use the same
`chainId`. For example, `'testnet'` and `'aleo:testnet'` create separate groups
of reservations even when both clients contact the same testnet node.

### Share a store and retain it across restarts

Two calls can scan the same record before either starts proving. The store
resolves that race by acquiring all inputs for one transaction in a single
operation. If any input is already reserved, it acquires none of them.

The lock covers that acquisition only. Once two calls have reserved different
inputs, they can prove concurrently:

```text
Call A: scan -> reserve record 1 -> prove ---------> submit -> confirm
Call B: scan -> reserve record 2 -> prove -> submit ---------> confirm
                    |
             shared inventory store
```

The journal retains the reservations after the lock is released. A record's
nonce identifies it across scanner and wallet responses. Reads and plans do
not acquire nonces; execution does.

Choose storage according to which clients must coordinate and whether the
journal must survive a restart:

| Store | Coordination | Restart behavior |
| --- | --- | --- |
| `memoryRecordInventoryStore()` | Clients sharing the same object in one process | Entries disappear when the process exits. |
| `sqliteRecordInventoryStore(path)` | Participating processes opening the same SQLite database | Reservations and prepared transactions remain on disk. Node 22.13+ only. |
| Custom `RecordInventoryStore` | Determined by its implementation | The implementation must persist mutations before resolving them if recovery is required. |

The Node SQLite adapter is an optional export of
`@provablehq/shield-swap-cli/storage`; install that package to use it. It is not
a dependency of core or the Shield Swap SDK. Replace the memory store above
with a stable path scoped to the account and network:

```ts
import { sqliteRecordInventoryStore } from '@provablehq/shield-swap-cli/storage'

const store = await sqliteRecordInventoryStore('.veil/testnet/trading-account/inventory.sqlite')
// Pass store in recordManagement when constructing every participating client.
// Call store.close() only after all of those clients have finished their work.
```

For two local signers in the same process, pass that same `store` object to
both client configurations. Both sign for the same account and share its
reservations:

```ts
const createParticipant = () => aleo.createAleoClient({
  privateKey,
  records: aleo.createRemoteScanner({ waitForSync: true }),
  recordManagement: { enabled: true, store, chainId: 'aleo:testnet' },
}).walletClient

const firstClient = createParticipant()
const secondClient = createParticipant()
// Writes through either client see reservations made through the other.
```

For a custom backend, implement `RecordInventoryStore` with these guarantees:

| Operation | Required behavior |
| --- | --- |
| `acquire` | Atomically check and acquire every requested nonce within the account/chain scope, or acquire none. A separate `list()` followed by an insert leaves a race. |
| `acquire` and `update` | Persist the change before resolving the promise when recovery must survive a restart. |
| Selection after confirmation | Continue excluding consumed inputs even if a scanner still reports them as unspent. |
| Selection after rejection | Release execution inputs, but keep a consumed private fee record excluded. |
| Uncertain submission | Keep reservations until the outcome is resolved. Do not release them on a timer. |

Coordination applies only to clients using this store and scope. Raw submissions,
other wallets, or traders using a different database can still spend the same
records. Shield Swap also needs a separate store for blinded identities and
claim handles; its [concurrent setup](./shield-swap.md#concurrent-swaps) covers both.

## Use the inventory methods

Choose an action based on the next spend. For example, a single transfer may
need one larger record, while a concurrent trading batch needs several records.
The methods below operate on `client`, configured above:

| Method | Effect |
| --- | --- |
| `client.getRecordInventory({ asset })` | Scans all pages and reports available records, reserved records, and available balance. |
| `client.joinRecords({ asset, records })` | Submits one native or helper join using the exact supplied records. Returns a transaction id before confirmation. |
| `client.splitRecord({ asset, record, amount })` | Submits a native split. The first output holds `amount` in base units. Returns before confirmation. |
| `client.autoJoin({ asset, minAmount? })` | Selects records and runs as many joins as needed to obtain a sufficient record, or one consolidated record if no threshold is supplied. |
| `client.planRecordInventory({ asset, target, maxTransactions? })` | Reads the inventory and returns an account/chain-bound plan without signing or reserving inputs. |
| `client.rebalanceRecordInventory({ plan, ... })` | Executes the reviewed plan, waiting for confirmation and scanner visibility before each dependent step. |
| `client.reconcileRecordInventory({ rebroadcast? })` | Checks pending transactions on chain; optionally rebroadcasts their saved proofs without rebuilding them. |

Reading, planning, and individual joins or splits remain available with
coordination disabled. Rebalance and reconciliation require it. `autoJoin`
requires it when joins are needed; an existing sufficient record returns
`complete` with zero transactions.

### Join only enough for a spend

Suppose a transfer needs one credit, but the account holds separate 0.4 and
0.6 credit records. `autoJoin` selects records and waits for the joined output
to become available. If a record already holds at least one credit, it returns
without submitting a join.

Amounts use integer base units: one credit is 1,000,000 microcredits. Request
that minimum explicitly:

```ts
const result = await client.autoJoin({
  asset: { program: 'credits.aleo' },
  minAmount: 1_000_000n,
  maxTransactions: 8,
  timeoutMs: 120_000,
  pollIntervalMs: 2_000,
  maxFeeMicrocredits: 10_000_000n,
})
if (result.status === 'interrupted') {
  console.error(result.reason, result.transactionIds)
  throw new Error('Resolve the interrupted joins before spending')
}
```

When a join is needed, `autoJoin` selects the largest records until their sum
covers `minAmount`. It prefers a compatible [batch helper](#batch-joins) and
waits for each output needed by a later step. Omitting `minAmount` consolidates
all eligible, unreserved records. The configured fee payment mode stays unchanged.

### Join or split exact records

Use `joinRecords` when the caller has already selected the inputs. This example
joins exactly two available credits records through the native program:

```ts
const credits = { program: 'credits.aleo' }
const beforeJoin = await client.getRecordInventory({ asset: credits })
const inputs = beforeJoin.available.slice(0, 2)
if (inputs.length !== 2) throw new Error('Two available credits records are required')

const joinId = await client.joinRecords({
  asset: credits, records: inputs, joinProgram: false,
})
console.log('Submitted join:', joinId)
```

`joinRecords` returns a transaction id before confirmation. Use `autoJoin` when
the next operation must wait for the exact joined record to appear in the scanner.
For more than two records in one transaction, omit `joinProgram` and supply a
count supported by an available helper; `autoJoin` handles larger sequences.

A split creates two positive outputs. For native credits, splitting a 1-credit
record with `amount: 400_000n` produces 0.4 and 0.59 credits. The split itself
deducts 10,000 microcredits, separately from the transaction fee:

```text
1,000,000 microcredits
          |
     native split
          |
          +--- 400,000 microcredits (requested first output)
          +--- 590,000 microcredits (remaining output)
          +---  10,000 microcredits (split deduction)
```

To make that first output from any sufficiently large available record:

```ts
const beforeSplit = await client.getRecordInventory({ asset: { program: 'credits.aleo' } })
const amount = 400_000n
const deduction = 10_000n
const source = beforeSplit.available.find((record) => record.amount > amount + deduction)
if (!source) throw new Error('No record can produce two positive outputs')

const splitId = await client.splitRecord({
  asset: { program: 'credits.aleo' }, record: source, amount,
})
console.log('Submitted split:', splitId)
```

This also returns before confirmation. Wait for confirmation and scanner
visibility before spending either output. The [planner](#plan-joins-and-splits)
handles those dependencies when preparing several records.

## Select the record and amount field

The `asset` argument identifies which program's records to manage. Most callers
need only `{ program: 'credits.aleo' }` or a token's program id. Core reads the
deployed `join` and `split` signatures to find the spendable record and its
amount type:

| Asset | Default record | Default amount field |
| --- | --- | --- |
| `credits.aleo` | `credits` | `microcredits` |
| ARC-20 or ARC-22 token | `Token` | `amount` |
| Another compatible program | Record accepted by its native join | `amount`, then `microcredits` |

`standard` is optional. When supplied, it is checked against the program.
For a custom program with different names, supply `recordName` or `amountField`.
For example, a deployed `points.aleo` program might join `Balance` records whose
balance is stored in `points`:

```ts
const asset = {
  program: 'points.aleo',
  recordName: 'Balance',
  amountField: 'points',
}
const inventory = await client.getRecordInventory({ asset })
```

The override applies to scans, wallet input requests, joins, splits, and plan
amounts. The record MUST match the native `join`/`split` inputs and outputs, and
the field MUST be an unsigned integer matching the split amount argument.
An override naming an undeclared record or field is an error; core does not
substitute another balance field.

Inspect `inventory.asset` to see the resolved record name, amount field, and
integer type. Only eligible fungible records are included: compliance records,
registry records, and records restricted to a particular recipient are excluded.

All inventory amounts use `bigint` in base units. Credits use u64; ARC tokens
use u128. Custom fields use their declared unsigned width: u8, u16, u32, u64,
or u128. Joins that overflow that width are invalid.

## Plan joins and splits

Use a plan when several operations must run in order. For example, preparing
six records may require a join followed by splits, with each split waiting for
the preceding transaction's output. Planning shows that sequence without signing,
reserving inputs, or submitting transactions.

The target describes the desired inventory after those operations:

| Option | Default | Meaning |
| --- | --- | --- |
| `target.records` | Required | Desired count, from 1 to 1,000. |
| `target.minRecordAmount` | `1n` | Minimum base-unit amount in each record. |
| `target.distribution` | `'preserve'` | Retain suitable existing records. Choose `'balanced'` to aim for equal amounts. |
| `target.toleranceBps` | `1000` (10%) | Allowed deviation from equal amounts when balancing, from 0 to 10,000. Use 0 for equal amounts, allowing integer rounding. |
| `maxTransactions` | `100` | Maximum joins and splits in the plan, up to 10,000. |

The planner keeps suitable records and splits directly where possible; otherwise
it consolidates before splitting. It does not guarantee the fewest possible
transactions. A required intermediate join that would overflow the asset's
amount type causes planning to fail.

### Review and execute a plan

Prepare six records with at least one credit each, and inspect the required
operations before spending:

```ts
const plan = await client.planRecordInventory({
  asset: { program: 'credits.aleo' },
  target: {
    records: 6, minRecordAmount: 1_000_000n,
    distribution: 'balanced', toleranceBps: 0,
  },
  maxTransactions: 24,
})
console.table(plan.steps.map((step) => ({
  operation: step.kind, inputs: step.inputs.length, outputs: step.outputs.length,
  helper: step.joinProgram?.program ?? 'native',
})))
console.log('Intrinsic split deductions:', plan.deduction.toString())
```

The target applies to the entire available asset inventory. Reserved records
remain outside it. Equal records can differ by one base unit because amounts
are integers. A plan is a snapshot, so execution rechecks its inputs and stops
if another operation has consumed or reserved them.

After reviewing the plan, execute that same object without modifying its steps:

```ts
const result = await client.rebalanceRecordInventory({
  plan,
  timeoutMs: 120_000,
  pollIntervalMs: 2_000,
  maxFeeMicrocredits: 10_000_000n,
})
if (result.status === 'interrupted') {
  console.error(result.reason, result.transactionIds)
  // Inspect confirmations before creating another plan. Accepted steps remain.
  await client.reconcileRecordInventory()
}
```

Execution submits real transactions. Limits apply at different points:

| Limit | What it controls |
| --- | --- |
| Client `recordManagement.maxFeeMicrocredits` | Maximum network fee for each transaction. |
| Action `maxFeeMicrocredits` | Total network fees across the maintenance run. Both fee limits apply when set. |
| Plan `maxTransactions` | Number of joins and splits, including batch joins. |
| Action `timeoutMs` | Confirmation and scanner visibility for each step. Proving time is additional. |
| Action `signal` | Stops further work after cancellation; it cannot cancel a transaction already submitted. |

Native credits split deductions are separate from network fees. Review
`plan.deduction` as well as the fee budget. If execution is interrupted, accepted
steps remain on chain; follow [recovery](#recover-interrupted-work) before
creating a replacement plan.

### Batch joins

A native join takes two records. Joining sixteen records that way needs fifteen
transactions. A batch helper calls the native joins within one transaction, so
Veil prefers a compatible helper when more than two records need joining.

For example, consolidating credits uses these sequences when the helper is
available:

| Starting inventory | Transactions |
| --- | --- |
| 2 records | One native `credits.aleo/join`. |
| 16 records | One helper `join_16`. |
| 17 records | One helper `join_16`, then a native join of its confirmed output and the remaining record. |

The exported `recordJoinPrograms` map lists helpers by network and source asset.
An entry for a specific program takes precedence over an ARC default:

| Asset | Mainnet helpers | Testnet helpers | Records per call |
| --- | --- | --- | --- |
| `credits.aleo` | `autojoin_credits_*` | `autojoin_credits_*` | 2 to 16 |
| USAD | `aj_usad_stablecoin_*` | `aj_test_usad_stablecoin_*` | 2 to 16 |
| USDCx | `aj_usdcx_stablecoin_*` | `aj_test_usdcx_stablecoin_*` | 2 to 16 |
| Other ARC-20/ARC-22 tokens | `main_aj_arc20_2_15.aleo` | `test_aj_arc20_2_15.aleo` | 2 to 15 |

For each `*`, the helper suffixes are `2_10.aleo`, `11_14.aleo`, and
`15_16.aleo`. Dedicated stablecoin entries apply to `usad_stablecoin.aleo` and
`usdcx_stablecoin.aleo` on mainnet, and their `test_` variants on testnet.
Each helper exposes `join_N` for the input counts in its range.

Core checks deployed function signatures before planning and again before
submission. Missing or incompatible helpers and unknown networks use native
pairwise joins. Lookup errors other than a missing program are reported to the
caller. Custom record or field selections use native joins unless they match
the helper's record and amount interface.

The planner selects the largest compatible batch that preserves the target
count and fits the amount width. It saves that choice in the plan so execution
uses the reviewed helper.

Keep the default helper lookup, disable it, or select a dynamic ARC router at
client creation:

| `recordManagement.tokenJoin` | Behavior |
| --- | --- |
| Omitted | Select helpers by asset and network; use native joins for two records. |
| `false` | Use native pairwise joins for every asset. |
| `{ program, maxRecords? }` | Use that dynamic ARC router for token joins, including two-record joins. `maxRecords` defaults to 15 and accepts 2 to 15. Credits keep their automatic helper selection. |

For example, to force native joins on testnet:

```ts
const { walletClient: nativeJoinClient } = aleo.createAleoClient({
  privateKey,
  records: aleo.createRemoteScanner({ waitForSync: true }),
  recordManagement: { enabled: true, store, chainId: 'aleo:testnet', tokenJoin: false },
})
```

Helper selection works with `enabled: false` for planning and individual joins.
It does not enable coordination or execute a plan. Custom clients can also use
`recordActions({ tokenJoin })` when no record management settings were supplied
during client creation. `joinRecords({ asset, records, joinProgram })` can
select a helper directly using its program, supported counts, and input mode;
`joinProgram: false` uses a native join for that call. Use `autoJoin` when the
records require more than one transaction.

The helper determines how join inputs are constructed:

| Helper | Inputs passed by Veil |
| --- | --- |
| Credits or dedicated stablecoin helper | The selected records. |
| Dynamic ARC helper | The underlying program identifier, such as `'test_arc20_eth'`, followed by the selected records. The token program is also supplied as a dynamic import. |

The Aleo SDK resolves transitive imports for local and delegated proving.
Wallet adapters must support these inputs and pin records from the underlying
token program.

A managed batch reserves every input together. Recovery entries retain the
source asset, fees, and proved transaction. Before a dependent step proceeds,
Veil waits for the encrypted record produced by the final native join inside
the helper. It uses that record's commitment, rather than the separate id of
the helper's external or dynamic return.

## Coordinate with Shield Swap

Attach `shieldSwapActions()` to the managed wallet client. The DEX methods
resolve symbols and token ids to the underlying asset that holds spendable
records. Maintenance operates on that program even when swaps use an AMM wrapper.

```ts
import { shieldSwapActions, parseUnits } from '@provablehq/shield-swap-sdk'

const dex = client.extend(shieldSwapActions({ api: {} }))
await dex.authenticateShieldSwap()
const token = await dex.tokenData('USDCx')
const plan = await dex.planInventory({
  token: token.id,
  target: { records: 6, minRecordAmount: parseUnits('0.1', token.decimals), distribution: 'balanced' },
  maxTransactions: 24,
})
// Inspect plan.steps. When approved, execute this exact plan:
// await dex.rebalanceRecordInventory({ plan })
```

`dex.rebalanceInventory({ token, target })` is a convenience method that creates
and executes a fresh plan. Use `dex.rebalanceRecordInventory({ plan })` when
executing a plan already inspected. Neither extending the client nor calling a
planner starts automatic maintenance.

Managed `writeContract`, `executeTransaction`, and `executeContract` calls
reserve their explicit record inputs before proving. Trading and maintenance
must use the same store and chain identity to see each other's reservations.

### Concurrent swaps

Six simultaneous USDCx sales need six input records and six distinct blinded
identities. A blinded identity receives a swap's proceeds until a claim collects
them. The two stores therefore have different responsibilities:

| Shared state | Purpose |
| --- | --- |
| Record inventory store and matching `chainId` | Prevent two participating calls from acquiring the same input record. |
| One blinded identity store instance | Allocate a separate identity to each swap and retain its claim information. |

With local signers and no explicit `tokenRecord`, `swap` and `swapMultiHop` scan
once for sufficient records, smallest first. A reservation conflict advances to
the next candidate before proving. Each record nonce is tried once; exhausting
the candidates fails the call. Fixed `tokenRecord` inputs stay fixed.

The trade amount, minimum output, blinded identity, and swap nonce stay unchanged
during selection. Each attempt checks the account, network, and quote expiry.
Proving, submission, and confirmation errors do not trigger another swap.
A failed execution-input reservation produces `RecordReservationConflictError`;
a missing private fee record produces a separate error.

Follow the [concurrent swaps walkthrough](./shield-swap.md#concurrent-swaps) for
a complete client setup, a reservation diagram, and code that inspects every
swap and claim. Its [runnable example](https://github.com/ProvableHQ/veil/blob/main/examples/shield-swap/concurrent-swaps.ts)
prepares six records and includes preview and recovery steps.

Run one process for an account with the bundled blinded identity stores. They
coordinate counters only within a process. Several clients in that process must
share the same store instance or supply distinct explicit identities. SQLite can
coordinate record reservations across processes, but it does not coordinate
blinded identity allocation.

## Recover interrupted work

A timeout can occur after a transaction has reached the network. Repeating the
original call at that point can submit a second operation. Recovery starts by
checking what happened to the saved transaction.

### 1. Reopen the journal and inspect outcomes

Recreate the client with its original durable store, account, and `chainId`.
An in-memory journal cannot recover entries lost when the process exited.
Then reconcile before submitting anything new:

```ts
const journal = await client.reconcileRecordInventory()
const unresolved = journal.filter((entry) =>
  !['confirmed', 'rejected', 'cancelled'].includes(entry.status),
)
console.table(unresolved.map((entry) => ({
  operation: entry.id, transactionId: entry.transactionId, status: entry.status,
})))
```

Reconciliation reads the chain and updates the journal. It does not submit
transactions by default. Any entries shown in `unresolved` still need attention;
a missing transaction or HTTP 404 does not prove rejection.

### 2. Resend a saved transaction when needed

If a prepared transaction is still missing and inspection calls for resending
it, explicitly enable rebroadcast:

```ts
await client.reconcileRecordInventory({ rebroadcast: true })
// Check confirmations again later; rebroadcast acceptance is not settlement.
```

Rebroadcast sends the exact saved transaction with its existing proof and id.
It neither rebuilds it nor resumes a partially completed plan. Check again on
a later poll; accepting a broadcast is not confirmation. Entries without a
saved transaction cannot be recovered by this option.

### 3. Plan against the confirmed inventory

Once uncertain submissions are resolved, read the inventory again and make a
new plan for the remaining work. Completed joins and splits have already changed
the available records. For Shield Swap, also [recover unfinished claims](./shield-swap.md#selection-failures-and-recovery)
before starting another batch.

The journal status explains why an input remains unavailable:

| Journal status | Record treatment |
| --- | --- |
| `reserved` | Inputs are held before proving. A local failure known to precede submission can cancel the reservation. |
| `prepared` / `submitted` | Inputs remain held until the chain outcome is known. |
| `confirmed` | Consumed inputs remain excluded from stale scanner results. |
| `rejected` | Execution inputs are released; a charged private fee record stays excluded. |
| `cancelled` | Inputs are available again because the local operation did not submit. |

## Interrupted work and wallets

The bundled Aleo SDK adapters save a local or delegated transaction before
broadcasting it. This gives the journal a proof and transaction id to recover.
For delegated proving, they request `broadcast: false` and submit only after
the checkpoint has been saved.

A custom `ProvingConfig.execute` adapter MUST await the `transaction-prepared`
progress callback before broadcasting. That callback persists the transaction
and checks the fee ceiling. Broadcasting first defeats both checks.

Connected wallets control their own records and submission. Record management
therefore needs enough information from the wallet to identify the exact inputs
and follow their outputs:

| Wallet capability | Why it is needed |
| --- | --- |
| Granted plaintext, or fields including `$nonce`, the amount, record name, and `recipient_bound` where applicable | Identify and validate records without relying on ciphertext alone. |
| A pinned record `uid` when plaintext is unavailable | Spend the record already reserved, rather than let the wallet select another. |
| Output `commitment` metadata or a `$commitment` grant | Find the exact new record needed by the next join or split. |

Rebalance checks commitment metadata before its first submission. Missing
metadata returns an interrupted result with no transactions submitted. A lost
wallet response without a transaction id leaves the reservation held for
external reconciliation.

Wallet submission cannot currently enforce a fee ceiling before broadcast or
pin a private fee record. Managed wallet execution therefore rejects fee budgets
and requires public fees or FeeMaster. Local signers support the private fee
selection below.

## Private fees

A private fee spends a `credits.aleo` record separately from the transaction's
execution inputs. Even when the transaction itself spends credits, its fee needs
a different record. Set `privateFee: true` on a managed local-account write to
have the client select and reserve that fee record.

Selection uses the estimated base fee plus any priority fee:

| Available credits records | Selection |
| --- | --- |
| A supplied `feeRecord` is unreserved, sufficient, and separate from the execution inputs | Use the supplied record. |
| The supplied record is reserved, insufficient, or already an execution input | Select the smallest other available record that covers the fee. |
| No `feeRecord` is supplied | Select the smallest available record that covers the fee. |
| All sufficient records are reserved or being spent by this transaction | Fail before proving. Records are not automatically joined and payment does not switch to public fees or FeeMaster. |

For example, this transfer sends one credit from the account's **public**
balance and pays its network fee from a separate private record. Set
`ALEO_RECIPIENT` to the recipient's address:

```ts
const recipient = process.env.ALEO_RECIPIENT
if (!recipient) throw new Error('Set ALEO_RECIPIENT')

const transferId = await client.writeContract({
  program: 'credits.aleo',
  function: 'transfer_public',
  inputs: [recipient, '1000000u64'],
  privateFee: true,
  // Omit feeRecord to select an available credits record automatically.
})
console.log('Submitted transfer:', transferId)
```

To prefer a particular record, pass its plaintext as `feeRecord`. An unavailable
preferred record is replaced according to the table above. The client reserves
the fee record and execution inputs together. If another call takes the fee
record first, selection tries the next candidate.

Before broadcast, the manager checks that the proved transaction spends the
reserved fee record and that its fee fits the balance and configured ceiling.
The journal stores the record's nonce and the proved transaction, without saving
record plaintext. Explicit private payment takes precedence over FeeMaster.

A rejected execution can still consume its private fee. Reconciliation releases
the execution inputs while retaining the spent `feeRecordId`. Timeouts retain
all reservations until the outcome is known.

The bundled local and delegated adapters honor the selected `feeRecord`.
Custom local provers also need `estimateExecutionFee` and MUST await the
prepared-transaction callback before broadcasting.

For a supervised background process with policies, cooldowns, budgets, and a
restart journal, use the [Shield Swap inventory commands](../packages/cli.md).

## Migrate a recordActions configuration

Move `store`, `chainId`, `maxFeeMicrocredits`, and `tokenJoin` into the client's
`recordManagement` configuration and set `enabled: true` to keep reservations
and recovery enabled. `createClient`, `createWalletClient`,
`aleo.createAleoClient`, and `createDevnodeClient` accept this option. Wallet
clients include the inventory methods without a `recordActions` extension.

For example, configure a fee ceiling and native joins on the client itself:

```ts
const { walletClient: managedClient } = aleo.createAleoClient({
  privateKey,
  records: aleo.createRemoteScanner({ waitForSync: true }),
  recordManagement: {
    enabled: true,
    store,
    chainId: 'aleo:testnet',
    maxFeeMicrocredits: 10_000_000n,
    tokenJoin: false,
  },
})
// managedClient already has getRecordInventory, autoJoin, and the other actions.
```

For an application still passing settings to the decorator:

| Option passed to `recordActions()` | Effect |
| --- | --- |
| `store`, `maxFeeMicrocredits` | Accepted but ignored. Configure them on the client to reserve records, enforce fees, and retain recovery entries. |
| `chainId`, `tokenJoin` | Apply only when the client has no record management configuration. Client settings take precedence. |

Existing assets with `standard` remain valid. New callers can supply only the
program or add record/field overrides. To keep native pairwise joins after
upgrading, set `tokenJoin: false`; omitting it now selects available helpers.
