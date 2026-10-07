#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { recordActions } from '@provablehq/veil-core'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { sqliteRecordInventoryStore } from './storage.js'
import { parseInventoryConfig } from './config.js'
import { runInventoryCycle } from './runner.js'

const HELP = `veil inventory <inspect|plan|rebalance|run|status>

  --config <file>       JSON policy configuration
  --asset <program>     One-off asset program (credits.aleo or an ARC token)
  --standard <type>     credits, arc20 or arc22 (required for non-credits assets)
  --records <count>     One-off target count, default 1
  --network <network>   testnet (default) or mainnet
  --database <file>     Shared SQLite journal; also VEIL_INVENTORY_DB
  --execute            Submit transactions; omission only prints plans
  --help               Show this help

Amounts in configuration are decimal strings in token base units.
The private key is read from ALEO_PRIVATE_KEY or config.privateKeyEnv.
run stays in the foreground for a service manager; Ctrl-C preserves pending work.
Node 22.13 or newer is required.`

const print = (value: unknown) => console.log(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2))

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    config: { type: 'string' }, asset: { type: 'string' }, standard: { type: 'string' }, records: { type: 'string' },
    network: { type: 'string' }, database: { type: 'string' }, execute: { type: 'boolean' }, help: { type: 'boolean' },
  } })
  if (values.help || !positionals.length) { console.log(HELP); return }
  const [group, command] = positionals
  if (group !== 'inventory' || !command || !['inspect', 'plan', 'rebalance', 'run', 'status'].includes(command) || positionals.length !== 2) throw new Error(HELP)
  const raw = values.config ? JSON.parse(await readFile(values.config, 'utf8')) : {}
  if (values.network) raw.network = values.network
  if (values.database || process.env.VEIL_INVENTORY_DB) raw.database = values.database ?? process.env.VEIL_INVENTORY_DB
  if (values.asset) raw.policies = [{ asset: { program: values.asset, standard: values.standard ?? (values.asset === 'credits.aleo' ? 'credits' : undefined) }, target: { records: Number(values.records ?? '1') } }]
  const config = parseInventoryConfig(raw)
  if (command !== 'status' && !config.policies.length) throw new Error('Supply --asset or configure at least one inventory policy')
  const privateKey = process.env[config.privateKeyEnv]
  if (!privateKey) throw new Error(`Set ${config.privateKeyEnv} to the signing account private key`)
  const aleo = await loadNetwork(config.network)
  const { walletClient, account } = aleo.createAleoClient({ privateKey, networkUrl: config.networkUrl, useFeeMaster: config.useFeeMaster,
    records: aleo.createRemoteScanner({ waitForSync: true }) })
  const store = await sqliteRecordInventoryStore(config.database)
  const client = walletClient.extend(recordActions({ store, chainId: config.chainId, maxFeeMicrocredits: config.maxFeeMicrocredits, tokenJoin: config.tokenJoin }))
  const scope = JSON.stringify([config.chainId, account.address])
  let lease: string | undefined
  const controller = new AbortController()
  const stop = () => controller.abort()
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    if (command === 'status') {
      print((await store.list(scope)).map(({ transaction: _transaction, ...entry }) => entry)); return
    }
    if (command === 'inspect') {
      for (const policy of config.policies) {
        const inventory = await client.getRecordInventory({ asset: policy.asset })
        print({ asset: policy.asset, balance: inventory.balance,
          available: inventory.available.map(({ id, amount }) => ({ id, amount })),
          reserved: inventory.reserved.map(({ id, amount }) => ({ id, amount })) })
      }
      return
    }
    if (command === 'plan' || !values.execute) {
      for (const policy of config.policies) print(await client.planRecordInventory({ ...policy, maxTransactions: config.maxTransactions }))
      return
    }
    const lock = await store.acquire({ scope, records: ['__inventory_manager__'], program: '__inventory_manager__', function: 'run',
      status: 'reserved', createdAt: Date.now(), accountType: 'local' })
    if (!lock) throw new Error('Another inventory manager is already running for this account and chain')
    lease = lock.id
    do {
      try {
        const results = await runInventoryCycle(client, config, store, scope, controller.signal)
        // Background runs emit only actionable results; stable inventory stays quiet.
        if (command !== 'run' || results.some((result) => !['satisfied', 'cooldown'].includes(result.status))) print(results)
        if (command !== 'run' && results.some((result) => ['interrupted', 'unavailable', 'waiting', 'budget'].includes(result.status))) process.exitCode = 1
      } catch (error) {
        if (command !== 'run') throw error
        console.error(error instanceof Error ? error.message : String(error))
      }
      if (command !== 'run' || controller.signal.aborted) break
      await delay(config.intervalMs, undefined, { signal: controller.signal }).catch((error) => { if (!controller.signal.aborted) throw error })
    } while (!controller.signal.aborted)
  } finally {
    try { if (lease) await store.update(scope, lease, { status: 'cancelled' }) }
    finally {
      store.close()
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
    }
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
