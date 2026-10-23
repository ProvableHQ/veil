# Shield Swap examples

These examples call the Shield Swap SDK from TypeScript. Start with
[setup-client.ts](./setup-client.ts) for account setup and
[swap.ts](./swap.ts) for a single swap and claim.

## Run concurrent swaps

[concurrent-swaps.ts](./concurrent-swaps.ts) prepares six balanced USDCx
records, submits six USDCx → ETH swaps concurrently, and claims their outputs.
Each trade spends 0.1 USDCx by default. Preparing the records can join and split
**the account's entire available USDCx inventory**; it leaves reserved records
out of the plan. At least 0.6 USDCx must be available.

Run from the repository root with Node 22.13 or newer and dependencies installed
(`pnpm install`). Set `VEIL_E2E_PRIVATE_KEY` through a local secret environment
to an existing funded **testnet** account with DEX access. The example neither
creates nor funds an account. For setup, follow the
[Shield Swap runbook](../../packages/shield-swap/skills/SKILL.md).

```sh
# Reads inventory, lists maintenance operations, and quotes a trade. No submissions.
pnpm exec tsx examples/shield-swap/concurrent-swaps.ts

# Prepares the records, submits six swaps, and claims each successful output.
pnpm exec tsx examples/shield-swap/concurrent-swaps.ts --execute
```

Execution uses delegated proving with FeeMaster paying network fees. It
explicitly sets `recordManagement: { enabled: true, store, chainId: 'aleo:testnet' }`.
Record management remains disabled for clients that omit that configuration.

To change the trade terms, import the example from another local script:

```ts
import { concurrentSwaps } from './concurrent-swaps.js'

// amountIn is a decimal string in input-token units. Preview is the default.
await concurrentSwaps({ from: 'USDCx', to: 'ETH', amountIn: '0.2', count: 6 })

// Run separately after inspecting the preview; this spends 1.2 USDCx in total.
await concurrentSwaps({ from: 'USDCx', to: 'ETH', amountIn: '0.2', count: 6, execute: true })
```

The plan requires one sufficient record per trade. Each `client.swap({ quote })`
selects its own input and acquires a reservation atomically. If another swap
reserves that input first, the SDK selects another candidate before proving.
The example leaves `tokenRecord` unset so this selection path applies.
Quotes retain their minimum output, but do not reserve pool liquidity; concurrent
trades can still fail as pool prices change.

`submitConcurrentSwaps` uses `Promise.allSettled` so one failed submission does
not discard successful handles. It then waits for every successful swap's
output and attempts its claim. A failed claim does not prevent other claims.
The result for each confirmed claim includes output and any unspent input
refund; a partial fill is not reported as a full fill.

## Keep recovery data

The default directory is `.veil/concurrent-swaps/testnet/<account-address>/`.
Pass `directory` to choose another location, and reuse it for that account:

| File | Purpose |
| --- | --- |
| `inventory.sqlite` | Stores record reservations and prepared transactions for reconciliation. |
| `blinded.json` | Stores sensitive blinded identities and handles needed to claim swap outputs. |
| `run.lock` | Prevents overlapping runs of this example against the same directory. |
| `batch.pending` | Remains after an interrupted batch so a later execution cannot silently repeat it. |

Keep these files private and outside version control. SQLite coordinates record
reservations across processes, but the identity store coordinates calls only
within one process. **Do not run another trader for the same account while this
example is running**, even with a different directory. Multiple clients within
one process must share the same inventory store and identity store objects.

After an interruption:

1. Stop the previous process. Remove a stale `run.lock` only after confirming
   that process has exited.
2. Recreate the client with the same account, network, `inventory.sqlite`, and
   `blinded.json` paths shown in the example. Call `reconcileRecordInventory(client)`
   to inspect pending transactions. A missing confirmation or a timeout does not
   prove failure; keep its reservation. The record guide describes
   [exact-transaction rebroadcast](../../site/docs/guides/record-inventory.md).
3. Call `client.syncBlindedIdentities()` and `client.getUnclaimedSwaps()` to
   locate finalized outputs. Claim entries carrying a handle with
   `client.claimSwapOutput({ handle })`. Investigate unresolved submissions and
   missing handles through the journal and swap history before any new trade.
4. Remove `batch.pending` only after every submitted transaction and claim has
   been resolved. Preview the current inventory again before starting a new batch.

The example never automatically rebuilds or repeats a swap after an uncertain
submission. All successful sibling swaps finish their claim attempts before an
error is reported, and both persistent stores survive that error.

## Check the example

```sh
# Offline checks of concurrent scheduling, claim failures, and command guards.
pnpm exec vitest run examples/shield-swap/concurrent-swaps.test.ts
pnpm exec tsc -p examples/shield-swap/tsconfig.json

# Live, read-only preview with a funded account already in the environment.
VEIL_INTEGRATION=1 pnpm exec vitest run examples/shield-swap/examples.test.ts -t 'concurrent-swaps preview'

# Explicitly opt into the funded six-swap batch and its inventory maintenance.
VEIL_INTEGRATION=1 VEIL_EXAMPLES_SPEND=1 VEIL_CONCURRENT_EXAMPLE=1 \
  pnpm exec vitest run examples/shield-swap/examples.test.ts -t 'prepares six records'
```

The offline tests replace network actions to check the example's orchestration.
The opt-in test exercises real scanning, planning, joins/splits when needed,
record reservations, delegated proving, submission, confirmation, and claims.
