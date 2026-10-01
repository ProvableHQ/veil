# @provablehq/veil-cli

Run scanner-backed record inventory management for native `credits.aleo`, ARC20,
and ARC22 tokens. Requires Node **22.13+** for built-in SQLite. SDK consumers do
not install this application or SQLite.

## Start

Install `@provablehq/veil-cli`, then supply the signing key through
`ALEO_PRIVATE_KEY` using the environment or a service manager's secret facility.
Amounts are integer token base units; credits use microcredits.

```sh
veil inventory inspect --asset credits.aleo
veil inventory plan --asset credits.aleo --records 4
veil inventory rebalance --asset credits.aleo --records 4 --execute
veil inventory run --config inventory.json --execute
veil inventory status --config inventory.json
```

`plan` never signs. `rebalance` and `run` also only print a plan unless
`--execute` is supplied. `run --execute` stays in the foreground; run it under
systemd, launchd, or another process supervisor for background operation.
Within this repository, use `pnpm veil inventory ...`.

## Policy configuration

```json
{
  "network": "testnet",
  "database": ".veil/inventory.sqlite",
  "privateKeyEnv": "ALEO_PRIVATE_KEY",
  "intervalMs": 30000,
  "cooldownMs": 60000,
  "maxTransactions": 10,
  "maxFeeMicrocredits": "1000000",
  "maxDailyFeeMicrocredits": "10000000",
  "useFeeMaster": false,
  "policies": [
    {
      "asset": { "program": "credits.aleo", "standard": "credits" },
      "target": { "records": 4, "minRecordAmount": "1000000", "distribution": "preserve" },
      "countRange": [3, 6]
    }
  ]
}
```

These settings show the defaults for application limits. The default network is
testnet, the default gateway is `https://edge.provable.com/api/v2`, and the default
journal is `.veil/inventory.sqlite`, relative to the working directory. Set
`networkUrl` for another node and `chainId` for a distinct chain; participants
MUST use the same identity (default `aleo:testnet` or `aleo:mainnet`). Do not
reuse the default identity across independent local chains.

- `records`: target count, 1–1000. `minRecordAmount` defaults to `"1"`.
- `distribution`: `preserve` avoids reshaping sufficient records; `balanced`
  requests approximately equal lots, within `toleranceBps` (default 1000, or 10%).
- `countRange`: optional inclusive range containing the target. While the count
  is in range and every record meets the minimum, maintenance does nothing,
  including for a balanced policy. Omit it to enforce the target distribution.
- `maxTransactions`: total planned transitions per maintenance pass.
- `maxFeeMicrocredits`: maximum fee for one transaction and total network-fee
  budget for one asset's rebalance. Fees are checked on the proved transaction
  before broadcast. `useFeeMaster: true` requests sponsored delegated proving.
- `maxDailyFeeMicrocredits`: rolling 24-hour maintenance limit. Counts journalled
  network fees and the intrinsic 10,000-microcredit deduction per credits split.
  Rejected/uncertain entries count conservatively. Participating trades contribute
  to recorded spend, but this setting does not impose a global trading budget.
- `cooldownMs`: delay after an operation on an asset; defaults to one minute.

For tokens, set `standard` to `arc20` or `arc22` and use the underlying program,
not an AMM wrapper or `token_registry.aleo`. Bound ARC22 records and compliance
records are excluded. The application reuses `createRemoteScanner` and waits for
its reported synchronization before planning.

## Recovery and shared trading

The scanner owns record discovery. The SQLite journal stores account/chain scope,
input nonces, operation state, transaction ids, fees, and the **proved encrypted
transaction** while it is pending. It stores neither keys nor record plaintext.
It creates the database with mode 0600 and new parent directories with mode 0700.

Each operation reserves inputs atomically, proves, saves the complete proved
transaction, and only then broadcasts. After acceptance, dependent steps wait
for those exact output commitments to appear in the scanner. An interrupted run
keeps completed chain operations; the next pass reconciles and plans from fresh
inventory. It never attempts to undo accepted joins or splits.

A timeout or 404 does not release inputs. Recovery can resubmit the saved
transaction with the same proof and id. Confirmed inputs remain excluded to
protect against stale scans. A local process that died before saving a proved
transaction can release its reservation; an uncertain wallet submission cannot.
No automatic age-based unlock is performed. Unresolved operations block further
maintenance until chain evidence resolves them; `status` displays their ids.
Keep the journal across restarts and **do not delete it to clear a pending spend**.
Recovery after indefinite dropped/rejected-without-chain-evidence transactions
requires operator reconciliation; no force-unlock command is included.

Only one manager can run for an account/chain against a shared journal. Pending
trading operations take priority over maintenance. Participating trading clients
must open the same file and apply `recordActions` before `shieldSwapActions`:

```ts
import { recordActions } from '@provablehq/veil-core'
import { sqliteRecordInventoryStore } from '@provablehq/veil-cli/storage'

const store = await sqliteRecordInventoryStore('.veil/inventory.sqlite')
const managed = walletClient.extend(recordActions({ store, chainId: 'aleo:testnet' }))
// Extend managed with shieldSwapActions(...) when trading.
// Close the store when the application shuts down.
```

For the Shield Swap CLI, set `VEIL_INVENTORY_DB` to this same database path and
select the same network. That opt-in integration also requires Node 22.13+.
Other SDK applications can implement `RecordInventoryStore` using their own
storage without depending on this package. Unmanaged wallets, raw transaction
submission, and other database files cannot participate in these reservations.
Managed writes use public fees or FeeMaster; private fee-record selection is
not coordinated and is rejected.

SIGINT/SIGTERM stops new work after the current operation returns. Proving or
an in-flight request may delay shutdown; durable checkpoints survive forced
termination. Avoid running maintenance against an account used by an
uncoordinated wallet.
