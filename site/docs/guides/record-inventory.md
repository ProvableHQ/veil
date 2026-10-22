# Record inventory

A private token balance can span many records. A swap may need one record large
enough to spend, while concurrent trades benefit from several independent
records. Inventory actions join or split these records to prepare the balance
for spending.

## Enable record coordination

Wallet clients include record inventory methods. Reads, planning, and individual
joins or splits work without enabling reservations or recovery.

Reservations keep participating clients from spending the same record. Recovery
tracks unfinished transactions so an interrupted operation can be reconciled
before more records are spent. Both are off by default, including after
`.extend(recordActions())`. Set `recordManagement.enabled: true` when creating
the client to enable them and execute plans with dependent steps.

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const { walletClient: client } = aleo.createAleoClient({
  privateKey, // supplied by the application
  records: aleo.createRemoteScanner({ waitForSync: true }),
  recordManagement: {
    enabled: true,
    chainId: 'aleo:testnet',
    tokenJoin: { program: 'test_aj_arc20_2_15.aleo' },
  },
})
const asset = { program: 'credits.aleo', standard: 'credits' } as const
const plan = await client.planRecordInventory({
  asset,
  target: { records: 4, distribution: 'balanced', minRecordAmount: 1_000_000n },
  maxTransactions: 10,
})
// Review plan.steps and plan.deduction before explicitly executing.
const result = await client.rebalanceRecordInventory({
  plan, maxFeeMicrocredits: 1_000_000n,
})
```

Core defines the planning, execution, and storage interfaces without requiring
a specific runtime. The Aleo SDK supplies the scanner and local or delegated
proving.

An enabled client uses an in-memory store unless the caller supplies one.
Disabled clients create no store. To recover unfinished operations after a
restart, long-running services MUST supply a durable `RecordInventoryStore`
through `recordManagement.store`. SQLite storage is available only from the
separate `@provablehq/veil-cli/storage` application package.

| Action | Behavior |
| --- | --- |
| `getRecordInventory({ asset })` | Reads all scanner pages; separates available and reserved records. |
| `joinRecords({ asset, records })` | Joins two native records, or 2–15 token records with a configured router; returns the transaction id. |
| `splitRecord({ asset, record, amount })` | Creates two outputs; `amount` is the first output's base-unit amount. |
| `autoJoin({ asset, minAmount? })` | Joins enough records to cover the amount, or all records if the amount is omitted. Execution requires record management to be enabled. |
| `planRecordInventory({ asset, target, maxTransactions? })` | Produces a read-only plan bound to its account and chain. |
| `rebalanceRecordInventory({ plan, ... })` | Runs each step and waits for its confirmed outputs to appear in the scanner. Requires record management to be enabled. |
| `reconcileRecordInventory({ rebroadcast? })` | Resolves pending journal entries and can rebroadcast the saved transaction. Requires record management to be enabled. |

Assets use `standard: 'credits'`, `'arc20'`, or `'arc22'`. Credits MUST use
`credits.aleo`. ARC tokens are checked against their deployed Token and join/split
interfaces. Compliance, registry, and recipient-bound records are excluded.
Amounts use `bigint`: u64 microcredits for credits and u128 base units for tokens.
A native credits split deducts 10,000 microcredits from its outputs, separately
from any transaction fee. Plans report the total intrinsic deduction.

`target.records` is 1–1000. `minRecordAmount` defaults to `1n`;
`distribution` defaults to `preserve`. `balanced` aims for equal amounts with
`toleranceBps` defaulting to 1000 (10%). The planner preserves already suitable
records and direct balanced splits where possible, otherwise consolidates and
splits. It is a bounded deterministic strategy, not an optimal transaction
solver; it rejects layouts whose required intermediate joins overflow the token
width. `maxTransactions` defaults to 100.

### Batch token consolidation

Configure `recordManagement.tokenJoin: { program, maxRecords? }` to route ARC20
and ARC22 joins through a dedicated dynamic join program. Mainnet uses
`main_aj_arc20_2_15.aleo`; testnet uses `test_aj_arc20_2_15.aleo`. `maxRecords`
defaults to 15 and accepts 2 to 15. Core selects no router by default; omitting
`tokenJoin` uses the token program's native join to combine two records at a time.
Credits always use native joins.

Routing works with `enabled: false` for planning or individual joins, without
reserving records. Custom clients can also use `recordActions({ tokenJoin })`
when no record management settings were supplied during client creation.

The planner batches only as many inputs as the target count requires and bounds
each summed amount to u128. Sixteen token records consolidate through `join_15`
and `join_2`, rather than fifteen separate transactions. `maxTransactions` counts
submitted transactions, including batch joins and native splits. Plans capture
their router; existing native plans retain their original execution path.

Each router call prepends the underlying program's identifier (for example,
`'test_usdcx_stablecoin'`) and supplies the token as a dynamic import. The Aleo SDK
resolves its transitive imports for both local and delegated proving. Wallet
adapters must support dynamic calls and pinned underlying-token records.

With management enabled, each batch reserves all its input records together.
The same journal records fees and saves proved transactions for recovery.
Confirmed router outputs carry dynamic ids. The executor finds each output's
record commitment in the nested token join, then waits for that record to
appear in the scanner. Intermediate records and unrelated deposits cannot
satisfy a dependent step.

## Coordinate with Shield Swap

```ts
const dex = client.extend(shieldSwapActions({ api: {} }))
const plan = await dex.planInventory({ token: 'USDCx', target: { records: 4 } })
const result = await dex.rebalanceInventory({ token: 'USDCx', target: { records: 4 } })
```

Import `shieldSwapActions` from `@provablehq/shield-swap-sdk`. The wrapper reads
`underlyingProgram` from the token metadata and uses core's inventory actions.
Create the wallet with `recordManagement: { enabled: true, store, chainId }`
before applying `shieldSwapActions`. Token selection then skips reserved records.
`writeContract`/`executeTransaction`/`executeContract` reserve all explicit record
inputs together before proving.

Independent clients MUST share the same store and chain identity to avoid
spending each other's reserved inputs. Raw submissions and wallets outside this
configuration bypass the reservations.

## Interrupted work and wallets

Execution returns `complete` or `interrupted`, with known transaction ids and
completed steps. No accepted transaction is rolled back. Reconcile, scan, and
plan again after interruption; do not blindly replay an old plan. The executor
checks each input and only feeds confirmed output commitments into later steps.
Defaults are a 120-second confirmation/output-visibility deadline per step and
one-second polling; proving time is additional. Cancellation stops subsequent
work and retains unresolved reservations.

A local prover MUST honor the awaited `transaction-prepared` progress callback
before broadcasting. Bundled SDK adapters do this for local and delegated
proving; delegated proving requests `broadcast: false` when checkpoints are
needed. The callback persists the transaction and checks the configured fee
ceiling. Custom `ProvingConfig.execute` adapters must follow this same contract.

Wallet clients need granted plaintext or record fields (`$nonce`, amount,
record name, and `recipient_bound` when applicable), plus a pinned record uid
for spending without plaintext. Dependent execution also needs output commitment
metadata (`commitment` or a `$commitment` grant). Rebalance checks consumed
records for this metadata before submitting its first step; missing metadata
returns an interrupted result with no submitted transactions.
Opaque wallet submission cannot enforce a fee ceiling before broadcast, so
wallet execution rejects configured fee budgets. A lost wallet response without
a transaction id retains its reservation for external reconciliation.

Private fee selection is rejected on managed writes because its inputs are
selected outside this reservation mechanism. Use public fees or FeeMaster.

For a supervised background process with policies, cooldowns, budgets, and a
restart journal, use the [inventory CLI](../packages/cli.md).

## Migrate a recordActions configuration

Move `store`, `chainId`, `maxFeeMicrocredits`, and `tokenJoin` into the client's
`recordManagement` configuration and set `enabled: true` to keep reservations
and recovery enabled. `createClient`, `createWalletClient`,
`aleo.createAleoClient`, and `createDevnodeClient` accept this option. Wallet
clients include the inventory methods without a `recordActions` extension.

`recordActions({ store, maxFeeMicrocredits })` accepts these options but ignores
them: they do not reserve records, enforce fee limits, or enable recovery.
Its `chainId` and `tokenJoin` options apply only when the client was created
without record management settings. Settings supplied during client creation
take precedence.
