import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from 'vitest'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { sqliteRecordInventoryStore } from '@provablehq/shield-swap-cli/storage'
import { getConfirmedTransaction } from '@provablehq/veil-core'
import type { InventoryRecord, InventoryTarget, OwnedRecord, RecordAsset, RecordInventoryStore, RecordManagementConfig, Transaction } from '@provablehq/veil-core'
import { shieldSwapActions, tokenData, parseUnits, formatUnits, type TokenInfo } from '../../src/index.js'
import { fileBlindedIdentityStore } from '../../src/node.js'

/** Enables only the explicitly requested testnet inventory write suites. */
export const RUN_INVENTORY = process.env.VEIL_INVENTORY_E2E === '1'
/** Allows proving, confirmation, and scanner indexing for one write. */
export const WRITE_TIMEOUT = 600_000
/** Allows a bounded sequence of dependent joins and splits. */
export const REBALANCE_TIMEOUT = 2_400_000

/**
 * Holds discovered token metadata and the independently configured inventory target.
 * @property asset Program-only descriptor resolved through the deployed ABI.
 * @property minimum Smallest allowed lot in base units.
 * @property target Record count and balanced distribution checked after maintenance.
 */
export type InventoryTestToken = TokenInfo & { asset: RecordAsset; minimum: bigint; target: InventoryTarget }

/**
 * Waits for a chain/scanner predicate without retrying any transaction submission.
 * @param label Condition included in the timeout error.
 * @param read Fetches the next chain or scanner observation.
 * @param ready Accepts an observation when the expected state is visible.
 * @param timeout Optional deadline in milliseconds; defaults to WRITE_TIMEOUT.
 * @returns The first observation satisfying the predicate.
 * @throws When a read fails or the deadline expires.
 * @example
 * const inventory = await poll('one record', scan, value => value.available.length === 1)
 */
export async function poll<T>(label: string, read: () => Promise<T>, ready: (value: T) => boolean, timeout = WRITE_TIMEOUT): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (ready(value)) return value
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  throw new Error(`Timed out waiting for ${label}; retain the inventory and blinded-identity stores before retrying`)
}

/**
 * Extracts an explicit local input without putting record plaintext in assertion output.
 * @param record Scanner record selected for the next testnet write.
 * @returns Decrypted record literal accepted by the local signer.
 * @throws When the provider omitted plaintext.
 * @example
 * const input = plaintext(inventory.available[0]!)
 */
export function plaintext(record: InventoryRecord): string {
  const value = (record.record as OwnedRecord).recordPlaintext
  if (!value) throw new Error('The live inventory suite requires locally decrypted records')
  return value
}

/**
 * Opens a testnet account with durable reservations and swap recovery data.
 * Reads VEIL_E2E_PRIVATE_KEY or VEIL_E2E_STATE_FILE; never generates a key or funds an account.
 * The default journal lives under .veil/inventory-e2e/testnet/<address>/ and survives the run.
 * @returns Connected clients and helpers; close the harness after the suite.
 * @throws On invalid setup, unresolved journal entries, or insufficient testnet balances.
 * @example
 * const harness = await createInventoryHarness()
 * try { await harness.scan(harness.tokens[0]!) } finally { await harness.close() }
 */
export async function createInventoryHarness() {
  const state = process.env.VEIL_E2E_STATE_FILE
    ? JSON.parse(await readFile(process.env.VEIL_E2E_STATE_FILE, 'utf8')) as { network?: string; privateKey?: string; apiUrl?: string }
    : undefined
  if (state && state.network !== 'testnet') throw new Error('VEIL_E2E_STATE_FILE must name a testnet session')
  const privateKey = process.env.VEIL_E2E_PRIVATE_KEY ?? state?.privateKey
  if (!privateKey) throw new Error('Set VEIL_E2E_PRIVATE_KEY or VEIL_E2E_STATE_FILE to an existing funded testnet account')
  const count = Number(process.env.VEIL_INVENTORY_RECORDS ?? 6)
  if (!Number.isInteger(count) || count < 3 || count > 16) throw new Error('VEIL_INVENTORY_RECORDS must be between 3 and 16')
  const aleo = await loadNetwork('testnet')
  const address = aleo.privateKeyToAccount(privateKey).address
  const scope = JSON.stringify(['aleo:testnet', address])
  const directory = process.env.VEIL_INVENTORY_E2E_DIR ?? join(process.cwd(), '.veil', 'inventory-e2e', 'testnet', address)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  // The blinded store serializes one process only. Refuse concurrent suites for
  // this account instead of racing counters or silently replacing test state.
  const lockPath = join(directory, 'run.lock')
  const lock = await open(lockPath, 'wx', 0o600)
  await lock.writeFile(`${process.pid}\n`)
  let store: Awaited<ReturnType<typeof sqliteRecordInventoryStore>> | undefined
  const identities = fileBlindedIdentityStore(process.env.VEIL_BLINDED_STORE ?? join(directory, 'blinded.json'))
  const connect = (journal?: RecordInventoryStore, options: Pick<RecordManagementConfig, 'tokenJoin' | 'maxFeeMicrocredits'> = {}) => aleo.createAleoClient({
    privateKey,
    networkUrl: 'https://edge.provable.com/api/v2',
    records: aleo.createRemoteScanner({ waitForSync: true, syncTimeoutMs: WRITE_TIMEOUT }),
    provingMode: 'delegated', useFeeMaster: true, confirmationTimeout: WRITE_TIMEOUT,
    ...(journal ? { recordManagement: { enabled: true, store: journal, chainId: 'aleo:testnet', ...options } } : {}),
  }).walletClient.extend(shieldSwapActions({
    api: { baseUrl: process.env.VEIL_E2E_API_URL ?? state?.apiUrl }, blindedIdentities: identities,
  }))
  try {
    store = await sqliteRecordInventoryStore(join(directory, 'inventory.sqlite'))
    let client = connect(store)
    await client.authenticateShieldSwap()
    const unresolved = (await client.reconcileRecordInventory()).filter(entry => !['confirmed', 'rejected', 'cancelled'].includes(entry.status))
    if (unresolved.length) throw new Error(`Resolve ${unresolved.length} pending inventory operations in ${directory} before another run`)
    const tokens = await Promise.all((['USDCx', 'ETH'] as const).map(async symbol => {
      const token = await tokenData(client.api, symbol)
      if (!token.underlyingProgram || !token.ammTokenProgram) throw new Error(`${symbol} lacks underlying/wrapper program metadata`)
      const minimum = parseUnits(symbol === 'USDCx'
        ? process.env.VEIL_INVENTORY_MIN_USDCX ?? '0.1'
        : process.env.VEIL_INVENTORY_MIN_ETH ?? '0.000001', token.decimals)
      if (minimum <= 0n) throw new Error(`${symbol} minimum must be positive`)
      const target: InventoryTarget = { records: count, minRecordAmount: minimum, distribution: 'balanced', toleranceBps: 0 }
      return { ...token, asset: { program: token.underlyingProgram }, minimum, target }
    }))
    const scan = (token: InventoryTestToken) => client.getRecordInventory({ asset: token.asset })
    for (const token of tokens) {
      const inventory = await scan(token)
      if (inventory.balance < token.minimum * BigInt(count + 1)) throw new Error(`Insufficient ${token.symbol} for ${count} records plus a trading margin`)
      console.log(`inventory preflight: ${token.symbol}, ${inventory.available.length} records, ${formatUnits(inventory.balance, token.decimals)} ${token.symbol}`)
    }
    const confirm = async (id: string): Promise<Transaction> => {
      const result = await poll(`confirmation of ${id}`, async () => {
        try { return await getConfirmedTransaction(client, { id }) }
        catch (error) { if ((error as { status?: number }).status === 404) return undefined; throw error }
      }, result => result !== undefined)
      if (result?.status !== 'accepted') throw new Error(`Transaction ${id} was not accepted`)
      await client.reconcileRecordInventory()
      return result.transaction as Transaction
    }
    const outputRecords = async (token: InventoryTestToken, id: string, expected: number) => {
      const transaction = await confirm(id)
      // Only outputs present in the accepted transaction may satisfy this step;
      // a concurrent deposit or a stale scanner page cannot masquerade as one.
      const commitments = new Set(transaction.execution?.transitions.flatMap(transition => transition.outputs ?? [])
        .filter(output => output.type === 'record' || output.type === 'record_with_dynamic_id').map(output => output.id))
      const inventory = await poll(`${token.symbol} outputs of ${id}`, () => scan(token), inventory =>
        inventory.available.filter(record => commitments.has(record.record.commitment!)).length === expected)
      return inventory.available.filter(record => commitments.has(record.record.commitment!))
    }
    const assertBalanced = async (token: InventoryTestToken) => {
      const inventory = await scan(token)
      expect(inventory.available.length, `${token.symbol} record count`).toBe(count)
      expect(inventory.reserved.length, `${token.symbol} pending inputs`).toBe(0)
      expect(inventory.available.every(record => record.amount >= token.minimum), `${token.symbol} minimum`).toBe(true)
      const amounts = inventory.available.map(record => record.amount).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
      // Zero tolerance permits only integer rounding: equal lots differ by at most one base unit.
      expect(amounts.at(-1)! - amounts[0]!, `${token.symbol} balanced amounts`).toBeLessThanOrEqual(1n)
      expect(new Set(inventory.available.map(record => record.id)).size).toBe(count)
      return inventory
    }
    const rebalance = async (token: InventoryTestToken) => {
      const before = await scan(token)
      const result = await client.rebalanceInventory({ token: token.id, target: token.target,
        maxTransactions: 24, timeoutMs: WRITE_TIMEOUT, pollIntervalMs: 3000 })
      expect(result.status, result.reason).toBe('complete')
      const after = await assertBalanced(token)
      expect(after.balance, `${token.symbol} rebalance conserves value`).toBe(before.balance)
      console.log(`inventory balanced: ${count} ${token.symbol} records, ${result.completedSteps} transactions`)
      return result
    }
    return {
      get client() { return client }, get store() { return store! }, identities, scope, tokens, count, directory,
      scan, confirm, outputRecords, assertBalanced, rebalance,
      peer: (options?: Pick<RecordManagementConfig, 'tokenJoin' | 'maxFeeMicrocredits'>) => connect(store, options), unmanaged: () => connect(),
      // Reopen the actual SQLite file to test recovery across client/store lifetimes.
      restart: async () => {
        store!.close()
        store = await sqliteRecordInventoryStore(join(directory, 'inventory.sqlite'))
        client = connect(store)
        await client.authenticateShieldSwap()
      },
      close: async () => { store!.close(); await lock.close(); await unlink(lockPath) },
    }
  } catch (error) {
    store?.close(); await lock.close(); await unlink(lockPath)
    throw error
  }
}

/** Captures the live client, durable stores, and independently checked inventory helpers. */
export type InventoryHarness = Awaited<ReturnType<typeof createInventoryHarness>>
