import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { sqliteRecordInventoryStore } from '../storage.js'
import { parseInventoryConfig } from '../inventory/config.js'
import { runInventoryCycle, type InventoryCycleResult } from '../inventory/runner.js'
import { loadState, resolveNetwork } from '../session.js'
import { flags, output, reportUsage, run } from '../shared.js'

const HELP = `shield-swap inventory <inspect|plan|rebalance|run|status>

  --config <file>       JSON policy configuration
  --asset <program>     One-off asset program (credits, ARC, or custom records)
  --standard <type>     Optional credits, arc20 or arc22 interface hint
  --record-name <name>  Override the record type selected for inventory
  --amount-field <name> Override the record field used for amounts
  --records <count>     One-off target count, default 1
  --network <network>   testnet (default) or mainnet
  --database <file>     Shared SQLite journal; also VEIL_INVENTORY_DB
  --execute            Submit transactions; omission only prints plans
  --json               One result object; run emits its summary on shutdown
  --no-color           Plain output
  -h, --help           Show this help

Amounts in configuration are decimal strings in token base units.
Uses ALEO_PRIVATE_KEY (or config.privateKeyEnv), then the Shield Swap account.
run stays in the foreground for a service manager; Ctrl-C preserves pending work.
Node 22.13 or newer is required. No DEX authentication is needed.`

// Keep base-unit amounts exact for custom assets, including u128 token balances.
const print = (value: unknown) => output(value, data => console.log(JSON.stringify(data, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2)))

/**
 * Dispatches record inspection, planning, maintenance, and journal status.
 * Reads the configured account without DEX authentication. Only explicit
 * --execute on rebalance or run may prove and submit transactions.
 * @param argv Arguments following `shield-swap inventory`.
 * @returns Resolves after output or shutdown; failures set the process exit code.
 * @example
 * await main(['plan', '--asset', 'credits.aleo', '--records', '4', '--json'])
 */
export async function main(argv: string[]): Promise<void> {
  // Parse the inventory verb separately, then let the shared parser enforce
  // the same help, unknown-flag, and JSON error conventions as trading commands.
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    flags({}, HELP, ['--help'])
    return
  }
  const [command, ...args] = argv
  if (!['inspect', 'plan', 'rebalance', 'run', 'status'].includes(command!)) reportUsage(`Unknown inventory command: ${command}`, HELP, argv)
  const values = flags({
    config: { type: 'string' }, asset: { type: 'string' }, standard: { type: 'string' },
    'record-name': { type: 'string' }, 'amount-field': { type: 'string' }, records: { type: 'string' }, database: { type: 'string' },
  }, HELP, args)
  await run(async () => {
    // Apply command-line overrides before validating policies. Network state
    // and the signing key follow the existing Shield Swap session conventions.
    const raw = values.config ? JSON.parse(await readFile(values.config as string, 'utf8')) : {}
    raw.network = resolveNetwork(values.network ?? raw.network)
    if (values.database || process.env.VEIL_INVENTORY_DB) raw.database = values.database ?? process.env.VEIL_INVENTORY_DB
    if (values.asset) raw.policies = [{ asset: { program: values.asset, standard: values.standard, recordName: values['record-name'], amountField: values['amount-field'] }, target: { records: Number(values.records ?? '1') } }]
    const config = parseInventoryConfig(raw)
    if (command !== 'status' && !config.policies.length) throw new Error('Supply --asset or configure at least one inventory policy')
    const privateKey = process.env[config.privateKeyEnv] || loadState(config.network).privateKey
    if (!privateKey) throw new Error(`Set ${config.privateKeyEnv} or run shield-swap setup --network ${config.network} to configure an account`)
    const aleo = await loadNetwork(config.network)
    const store = await sqliteRecordInventoryStore(config.database)
    let scope: string | undefined
    let lease: string | undefined
    const controller = new AbortController()
    const stop = () => controller.abort()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    try {
      // Inventory opts into coordination explicitly. Ordinary trading remains
      // unmanaged unless its session is configured with VEIL_INVENTORY_DB.
      const { walletClient: client, account } = aleo.createAleoClient({ privateKey, networkUrl: config.networkUrl, useFeeMaster: config.useFeeMaster,
        records: aleo.createRemoteScanner({ waitForSync: true }),
        recordManagement: { enabled: true, store, chainId: config.chainId, maxFeeMicrocredits: config.maxFeeMicrocredits, tokenJoin: config.tokenJoin } })
      scope = JSON.stringify([config.chainId, account.address])
      const identity = { network: config.network, address: account.address }
      if (command === 'status') {
        // Print operation metadata without the stored proved transaction payload.
        print({ ...identity, operations: (await store.list(scope)).map(({ transaction: _transaction, ...entry }) => entry) })
        return
      }
      if (command === 'inspect') {
        const inventories = []
        for (const policy of config.policies) {
          const inventory = await client.getRecordInventory({ asset: policy.asset })
          inventories.push({ asset: policy.asset, balance: inventory.balance,
            available: inventory.available.map(({ id, amount }) => ({ id, amount })),
            reserved: inventory.reserved.map(({ id, amount }) => ({ id, amount })) })
        }
        print({ ...identity, inventories })
        return
      }
      // All write commands stop at planning unless --execute was supplied.
      if (command === 'plan' || !values.execute) {
        const plans = []
        for (const policy of config.policies) plans.push(await client.planRecordInventory({ ...policy, maxTransactions: config.maxTransactions }))
        print({ ...identity, plans })
        return
      }
      // Reserve a synthetic record id to allow only one maintenance loop per
      // account and chain, while trading reserves actual record nonces.
      const lock = await store.acquire({ scope, records: ['__inventory_manager__'], program: '__inventory_manager__', function: 'run',
        status: 'reserved', createdAt: Date.now(), accountType: 'local' })
      if (!lock) throw new Error('Another inventory manager is already running for this account and chain')
      lease = lock.id
      let cycles = 0
      let results: InventoryCycleResult[] = []
      let lastError: string | undefined
      do {
        cycles++
        try {
          results = await runInventoryCycle(client, config, store, scope, controller.signal)
          lastError = undefined
          // Human service logs report actionable cycles. JSON accumulates only
          // the latest outcome and emits one bounded summary on shutdown.
          if (command !== 'run' || (!values.json && results.some(result => !['satisfied', 'cooldown'].includes(result.status)))) print({ ...identity, results })
          if (command !== 'run' && results.some(result => ['interrupted', 'unavailable', 'waiting', 'budget'].includes(result.status))) process.exitCode = 1
        } catch (error) {
          if (command !== 'run') throw error
          results = []
          lastError = error instanceof Error ? error.message : String(error)
          if (!values.json) console.error(lastError)
        }
        if (command !== 'run' || controller.signal.aborted) break
        await delay(config.intervalMs, undefined, { signal: controller.signal }).catch(error => { if (!controller.signal.aborted) throw error })
      } while (!controller.signal.aborted)
      if (command === 'run' && values.json) print({ ...identity, cycles, results, ...(lastError ? { error: { message: lastError } } : {}) })
    } finally {
      // Release only the manager lease; transaction reservations must survive
      // shutdown so the next process can reconcile their chain status.
      try { if (lease && scope) await store.update(scope, lease, { status: 'cancelled' }) }
      finally {
        store.close()
        process.removeListener('SIGINT', stop)
        process.removeListener('SIGTERM', stop)
      }
    }
  })
}
