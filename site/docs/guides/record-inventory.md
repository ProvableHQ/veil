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
  },
})
const asset = { program: 'credits.aleo' }
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
| `joinRecords({ asset, records })` | Joins two records natively, or up to 16 with an available helper (15 for dynamic ARC helpers); returns the transaction id. |
| `splitRecord({ asset, record, amount })` | Creates two outputs; `amount` is the first output's base-unit amount. |
| `autoJoin({ asset, minAmount? })` | Joins enough records to cover the amount, or all records if the amount is omitted. Execution requires record management to be enabled. |
| `planRecordInventory({ asset, target, maxTransactions? })` | Produces a read-only plan bound to its account and chain. |
| `rebalanceRecordInventory({ plan, ... })` | Runs each step and waits for its confirmed outputs to appear in the scanner. Requires record management to be enabled. |
| `reconcileRecordInventory({ rebroadcast? })` | Resolves pending journal entries and can rebroadcast the saved transaction. Requires record management to be enabled. |

## Select the record and amount field

`RecordAsset` requires only `program`. Core reads the deployed program's
join/split interface to select the record and its unsigned amount width.
ARC20/ARC22 tokens use `Token.amount`; native credits use
`credits.microcredits`. For other records, the default field is `amount`,
then `microcredits`. `standard` is an optional hint checked against the program.

Supply `recordName` or `amountField` to override either default:

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
A missing override is an error; core does not substitute another balance field.
`getRecordInventory` returns the resolved selection in `inventory.asset`.
Compliance, registry, and recipient-bound records are excluded.

Amounts use `bigint` in base units. Credits are bounded by u64 and ARC tokens by
u128; custom fields use their declared width (u8, u16, u32, u64, or u128).
A native credits split deducts 10,000 microcredits from its outputs, separately
from any transaction fee. Plans report the total intrinsic deduction.

## Plan joins and splits

`target.records` is 1–1000. `minRecordAmount` defaults to `1n`;
`distribution` defaults to `preserve`. `balanced` aims for equal amounts with
`toleranceBps` defaulting to 1000 (10%). The planner preserves already suitable
records and direct balanced splits where possible, otherwise consolidates and
splits. It is a bounded deterministic strategy, not an optimal transaction
solver; it rejects layouts whose required intermediate joins overflow the token
width. `maxTransactions` defaults to 100.

### Batch joins

When more than two records need joining, core prefers available helper programs
that combine them in one transaction. The exported `recordJoinPrograms` map
lists candidates by network and source asset. Exact program entries take
precedence over ARC defaults.

| Asset | Mainnet helpers | Testnet helpers | Records per call |
| --- | --- | --- | --- |
| `credits.aleo` | `autojoin_credits_*` | `autojoin_credits_*` | 2 to 16 |
| USAD | `aj_usad_stablecoin_*` | `aj_test_usad_stablecoin_*` | 2 to 16 |
| USDCx | `aj_usdcx_stablecoin_*` | `aj_test_usdcx_stablecoin_*` | 2 to 16 |
| Other ARC20/ARC22 tokens | `main_aj_arc20_2_15.aleo` | `test_aj_arc20_2_15.aleo` | 2 to 15 |

For each `*`, the helper suffixes are `2_10.aleo`, `11_14.aleo`, and
`15_16.aleo`. Dedicated stablecoin entries apply to `usad_stablecoin.aleo` and
`usdcx_stablecoin.aleo` on mainnet, and their `test_` variants on testnet.
Each helper exposes `join_N` for the input counts in its range.

Core checks deployed function signatures before planning and again before
submission. Missing or incompatible helpers and unknown networks use native
pairwise joins. Lookup errors other than a missing program are reported to the
caller. Custom record or field selections use native joins unless they match
the helper's record and amount interface.

The planner picks the largest compatible batch that preserves the target count
and fits the amount width. Sixteen credits records use one `join_16` call;
seventeen use `join_16`, then a native join with its confirmed output.
Two-record joins use the native program by default. `maxTransactions` counts
submitted transactions, including batch joins and native splits. Plans retain
the selected helpers so execution follows the reviewed plan.

`recordManagement.tokenJoin` controls overrides:

- Omit it to select helpers by asset and network.
- Set `false` to use native pairwise joins for every asset.
- Set `{ program, maxRecords? }` to select a dynamic ARC router explicitly.
  `maxRecords` defaults to 15 and accepts 2 to 15. This router also handles
  two-record token joins; credits still use their automatically selected helpers.

Helper selection works with `enabled: false` for planning and individual joins.
It does not enable coordination or execute a plan. Custom clients can also use
`recordActions({ tokenJoin })` when no record management settings were supplied
during client creation. `joinRecords({ asset, records, joinProgram })` can
select a helper directly using its program, supported counts, and input mode;
`joinProgram: false` uses a native join for that call. Use `autoJoin` when the
records require more than one transaction.

Credits and dedicated stablecoin helpers take only records. Dynamic ARC helpers
prepend the underlying program identifier, such as `'test_arc20_eth'`, and
supply the token as a dynamic import. The Aleo SDK resolves its transitive
imports for local and delegated proving. Wallet adapters must support the
selected helper's inputs and pinned records from the underlying program.

With management enabled, a batch reserves all inputs together. The journal
attributes the call to the source asset and retains fees and proved transactions
for recovery. Static helper outputs expose record commitments directly. For a
dynamic helper, execution matches its output id to the nested token join's
commitment. Dependent steps wait for that exact record to appear in the scanner.

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

Wallet clients need granted plaintext or record fields (`$nonce`, the selected amount field,
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

Existing assets with `standard` remain valid. New callers can supply only the
program or add record/field overrides. To keep native pairwise joins after
upgrading, set `tokenJoin: false`; omitting it now selects available helpers.
