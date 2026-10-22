# Record inventory management

`shield-swap inventory` manages spendable records for native `credits.aleo`,
ARC20, ARC22, and compatible custom assets. It reads records from the scanner,
plans joins and splits, and keeps a journal for recovery after interruptions.
Requires Node **22.13+** for built-in SQLite. SDK packages retain their existing
runtime requirements.

## Start

Install `@provablehq/shield-swap-cli`. Inventory commands use the account saved
by `shield-swap setup` for the selected network. To select another account, set
`ALEO_PRIVATE_KEY` through the environment or a service manager's secret facility;
`privateKeyEnv` changes the variable name. Inventory does not require DEX
authentication. Amounts are integer token base units; credits use microcredits.

```sh
shield-swap inventory inspect --asset credits.aleo
shield-swap inventory plan --asset credits.aleo --records 4
shield-swap inventory rebalance --asset credits.aleo --records 4 --execute
shield-swap inventory run --config inventory.json --execute
shield-swap inventory status --config inventory.json
```

`plan` never signs. `rebalance` and `run` also only print a plan unless
`--execute` is supplied. `run --execute` stays in the foreground; run it under
systemd, launchd, or another process supervisor for background operation.
Within this repository, use `pnpm shield-swap inventory ...`. Add `-s` to pnpm
when parsing JSON: `pnpm -s shield-swap inventory status --json`.

`inspect`, `plan`, `rebalance`, and `status` accept `--json` and return one
object with the network, account address, and results. For `run --execute`,
`--json` prints one summary when the process receives SIGINT or SIGTERM; it
includes the cycle count and the last cycle's results. Without `--json`, the
loop prints actionable results as they occur.

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
      "asset": { "program": "credits.aleo" },
      "target": { "records": 4, "minRecordAmount": "1000000", "distribution": "preserve" },
      "countRange": [3, 6]
    }
  ]
}
```

These settings show the defaults for application limits. The default network is
testnet, the default gateway is `https://edge.provable.com/api/v2`, and the default
journal is `.veil/inventory.sqlite`, relative to the working directory.
`--network` overrides the config file, then `SHIELD_SWAP_NETWORK`, then testnet.
`--database` overrides `VEIL_INVENTORY_DB`, which overrides the config file.
Account files follow `SHIELD_SWAP_STATE_DIR`, as with trading commands. Set
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
- `tokenJoin`: optional dynamic ARC router override. By default, core selects
  available helpers for the asset and network. Credits and dedicated stablecoin
  helpers accept up to 16 records; dynamic ARC helpers accept up to 15.
  Set `{ "program": "custom_router.aleo", "maxRecords": 15 }` for a custom
  dynamic router, or `false` for native pairwise joins on every asset.
  Transaction limits count batch submissions, not their nested token calls.
- `maxFeeMicrocredits`: maximum fee for one transaction and total network-fee
  budget for one asset's rebalance. Fees are checked on the proved transaction
  before broadcast. `useFeeMaster: true` requests sponsored delegated proving.
- `maxDailyFeeMicrocredits`: rolling 24-hour maintenance limit. Counts journalled
  network fees and the intrinsic 10,000-microcredit deduction per credits split.
  Rejected/uncertain entries count conservatively. Participating trades contribute
  to recorded spend, but this setting does not impose a global trading budget.
- `cooldownMs`: delay after an operation on an asset; defaults to one minute.

An asset requires only `program`. Use the token's underlying program.
`recordName` and `amountField` override the detected record and balance field;
`standard` remains an optional hint. ARC tokens default to `Token.amount` and
credits to `credits.microcredits`. Custom records use `amount`, then
`microcredits`, unless a field is supplied. For a custom record:

```sh
shield-swap inventory plan --asset points.aleo --record-name Balance --amount-field points --records 4
```

The same names work in JSON: `"asset": { "program": "points.aleo",
"recordName": "Balance", "amountField": "points" }`. Bound, compliance, and
registry records are excluded. The application reuses `createRemoteScanner`
and waits for its reported synchronization before planning. See the
[record inventory guide](../../site/docs/guides/record-inventory.md) for helper
programs, field defaults, and execution requirements.

## Recovery and shared trading

The scanner owns record discovery. The SQLite journal stores account/chain scope,
input nonces, operation state, transaction ids, fees, and the **proved encrypted
transaction** while it is pending. It stores neither keys nor record plaintext.
Routed joins also record the underlying asset program so cooldowns remain per asset.
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

Only one manager can run for an account and chain using the same journal.
Pending trading operations take priority over maintenance. Trading clients MUST
open the same file and enable record coordination when creating the client:

```ts
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { sqliteRecordInventoryStore } from '@provablehq/shield-swap-cli/storage'

const store = await sqliteRecordInventoryStore('.veil/inventory.sqlite')
const aleo = await loadNetwork('testnet')
const { walletClient } = aleo.createAleoClient({
  privateKey, // supplied by the application
  recordManagement: {
    enabled: true, store, chainId: 'aleo:testnet',
  },
})
// Extend walletClient with shieldSwapActions(...) when trading.
// Close the store when the application shuts down.
```

For trading commands in the same CLI, set `VEIL_INVENTORY_DB` to this database
path and select the same network. This option requires Node 22.13+. Inventory
commands enable coordination for their own client. Trading commands and SDK
clients leave it off by default, including clients extended with `recordActions()`.

Applications can implement `RecordInventoryStore` with their own storage
without depending on this package. Reservations cover only clients that use the
same journal; unmanaged wallets and raw submissions bypass them. Managed writes
require public fees or FeeMaster because private fee selection can spend records
outside the shared reservations.

SIGINT/SIGTERM stops new work after the current operation returns. Proving or
an in-flight request may delay shutdown; durable checkpoints survive forced
termination. Avoid running maintenance against an account used by an
uncoordinated wallet.
