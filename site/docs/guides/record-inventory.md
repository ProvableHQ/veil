# Record inventory

A private token balance can span many records. A swap may need one record large
enough to spend, while concurrent trades benefit from several independent
records. Inventory actions join and split existing records to shape that balance.

## Add inventory actions

```ts
import { recordActions } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'

const aleo = await loadNetwork('testnet')
const { walletClient } = aleo.createAleoClient({
  privateKey, // supplied by the application
  records: aleo.createRemoteScanner({ waitForSync: true }),
})
const client = walletClient.extend(recordActions({
  chainId: 'aleo:testnet',
  tokenJoin: { program: 'test_aj_arc20_2_15.aleo' },
}))
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

Core provides runtime-independent planning, execution, and storage interfaces.
The Aleo SDK supplies the existing record scanner and local/delegated proving.
The default reservation store is in memory. Long-running services MUST supply
an appropriate durable `RecordInventoryStore`; SQLite is available exclusively
from the separate `@provablehq/veil-cli/storage` application package.

| Action | Behavior |
| --- | --- |
| `getRecordInventory({ asset })` | Reads all scanner pages; separates available and reserved records. |
| `joinRecords({ asset, records })` | Joins two native records, or 2–15 token records with a configured router; returns the transaction id. |
| `splitRecord({ asset, record, amount })` | Creates two outputs; `amount` is the first output's base-unit amount. |
| `autoJoin({ asset, minAmount? })` | Consolidates enough records to cover an amount, or all records when omitted. |
| `planRecordInventory({ asset, target, maxTransactions? })` | Produces a read-only plan bound to its account and chain. |
| `rebalanceRecordInventory({ plan, ... })` | Executes sequentially and waits for confirmed scanner outputs. |
| `reconcileRecordInventory({ rebroadcast? })` | Resolves pending journal entries; optional exact-transaction rebroadcast. |

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

Configure `recordActions({ tokenJoin: { program, maxRecords? } })` to route ARC20
and ARC22 joins through a dedicated dynamic join program. Mainnet uses
`main_aj_arc20_2_15.aleo`; testnet uses `test_aj_arc20_2_15.aleo`. `maxRecords`
defaults to 15 and accepts 2–15. Core has no network-specific router default;
omitting `tokenJoin` preserves native pairwise joins. Credits remain native.

The planner batches only as many inputs as the target count requires and bounds
each summed amount to u128. Sixteen token records consolidate through `join_15`
and `join_2`, rather than fifteen separate transactions. `maxTransactions` counts
submitted transactions, including batch joins and native splits. Plans capture
their router; existing native plans retain their original execution path.

Each router call prepends the underlying program's identifier (for example,
`'test_usdcx_stablecoin'`) and supplies the token as a dynamic import. The Aleo SDK
resolves its transitive imports for both local and delegated proving. Wallet
adapters must support dynamic calls and pinned underlying-token records.

All batch inputs are reserved atomically. Fees, durable proof checkpoints, and
exact-transaction recovery use the same inventory journal. Confirmed router
outputs carry dynamic ids; execution resolves each id to the matching nested
token join's record commitment before waiting for the scanner. Intermediate
records and unrelated deposits cannot satisfy a dependent step.

## Coordinate with Shield Swap

```ts
const dex = client.extend(shieldSwapActions({ api: {} }))
const plan = await dex.planInventory({ token: 'USDCx', target: { records: 4 } })
const result = await dex.rebalanceInventory({ token: 'USDCx', target: { records: 4 } })
```

Import `shieldSwapActions` from `@provablehq/shield-swap-sdk`. The wrapper resolves
token metadata to `underlyingProgram`, then uses the same core actions.
Apply `recordActions` first. Token selection skips shared reservations and
`writeContract`/`executeTransaction`/`executeContract` reserve explicit record
inputs atomically before proving. Independent clients MUST share the same store
and chain identity. This coordination does not cover raw submissions or other
wallets that do not participate.

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
metadata. Missing grants produce an error rather than a partial inventory.
Opaque wallet submission cannot enforce a fee ceiling before broadcast, so
wallet execution rejects configured fee budgets. A lost wallet response without
a transaction id retains its reservation for external reconciliation.

Private fee selection is rejected on managed writes because its inputs are
selected outside this reservation mechanism. Use public fees or FeeMaster.

For a supervised background process with policies, cooldowns, budgets, and a
restart journal, use the [inventory CLI](../packages/cli.md).
