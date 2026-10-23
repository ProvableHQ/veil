/**
 * Prepares six balanced USDCx records and swaps them for ETH concurrently.
 *
 * Preview: pnpm exec tsx examples/shield-swap/concurrent-swaps.ts
 * Execute: pnpm exec tsx examples/shield-swap/concurrent-swaps.ts --execute
 *
 * Requires Node 22.13+, VEIL_E2E_PRIVATE_KEY, a funded testnet account and DEX
 * access. Execution reshapes the entire available input-token inventory, then
 * spends 0.1 USDCx per swap by default. See README.md for recovery instructions.
 */
import { mkdir, open, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadNetwork } from '@provablehq/veil-aleo-sdk'
import { formatUnits, parseUnits, shieldSwapActions, type ShieldSwapActions, type SwapQuote } from '@provablehq/shield-swap-sdk'
import { swapFileStore } from '@provablehq/shield-swap-sdk/node'
import { sqliteRecordInventoryStore } from '@provablehq/shield-swap-cli/storage'

/**
 * Submits swaps together and claims every successful output.
 *
 * All calls use the client's record journal and blinded identity store. A failed
 * swap or claim leaves the other trades running, and no submission is retried.
 *
 * @param client Local signer configured with record management and persistent swap identities.
 * @param offers Fresh quotes, one per trade. An empty list submits nothing.
 * @returns Swap results, successful handles, and claim results. `claims[i]` belongs to `handles[i]`.
 * @example
 * const offer = await client.quote({ from: 'USDCx', to: 'ETH', amountIn: '0.1' })
 * const batch = await submitConcurrentSwaps(client, Array(6).fill(offer))
 * console.log(batch.swaps.map((result) => result.status))
 */
export async function submitConcurrentSwaps(
  client: Pick<ShieldSwapActions, 'swap' | 'waitForSwapOutput' | 'claimSwapOutput'>,
  offers: readonly SwapQuote[],
) {
  // Leave tokenRecord unset so the client can select another record if a
  // concurrent swap reserves its first choice. Keep every submission result.
  const swaps = await Promise.allSettled(offers.map((quote) => client.swap({ quote })))
  const handles = swaps.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])

  // Each successful swap needs a separate claim. Waiting for all claim attempts
  // ensures that one failure does not prevent the remaining payouts.
  const claims = await Promise.allSettled(handles.map(async (handle) => {
    await client.waitForSwapOutput({ handle, timeout: 600_000, pollingInterval: 3_000 })
    return client.claimSwapOutput({ handle })
  }))
  return { swaps, handles, claims }
}

/**
 * Configures the testnet example without changing SDK defaults.
 * @property privateKey Existing funded key. Defaults to VEIL_E2E_PRIVATE_KEY; never generated or saved.
 * @property execute Enables inventory maintenance and swaps; defaults to false (preview).
 * @property from Input symbol or token id. Defaults to USDCx.
 * @property to Output symbol or token id. Defaults to ETH.
 * @property amountIn Decimal input-token units per trade. Defaults to '0.1'.
 * @property count Concurrent trades and target record count. Defaults to 6; accepts 2 through 16.
 * @property directory Persistent recovery directory. Defaults to .veil/concurrent-swaps/testnet/<address>.
 */
export type ConcurrentSwapsOptions = {
  privateKey?: string
  execute?: boolean
  from?: string
  to?: string
  amountIn?: string
  count?: number
  directory?: string
}

/**
 * Prepares private records and runs several swaps at once.
 * Defaults to a preview. Execution uses delegated proving with FeeMaster payment
 * and saves record reservations and swap handles for recovery after a restart.
 * @param options Testnet account, trade terms and explicit execution opt-in.
 * @returns The inventory plan and, after execution, the swap and claim results.
 * @throws On invalid configuration, unresolved prior work, maintenance interruption or any failed trade.
 * @example
 * await concurrentSwaps() // Preview with VEIL_E2E_PRIVATE_KEY; submits nothing.
 * // After inspecting the preview, execute with the same account and directory:
 * await concurrentSwaps({ execute: true, count: 6, amountIn: '0.1' })
 */
export async function concurrentSwaps(options: ConcurrentSwapsOptions = {}) {
  const privateKey = options.privateKey ?? process.env.VEIL_E2E_PRIVATE_KEY
  if (!privateKey) throw new Error('Set VEIL_E2E_PRIVATE_KEY to an existing funded testnet account with DEX access')
  const { count = 6, from = 'USDCx', to = 'ETH', amountIn = '0.1' } = options
  if (!Number.isInteger(count) || count < 2 || count > 16) throw new Error('count must be an integer from 2 through 16')
  if (from === to) throw new Error('from and to must differ')

  const aleo = await loadNetwork('testnet')
  const address = aleo.privateKeyToAccount(privateKey).address
  const directory = resolve(options.directory ?? `.veil/concurrent-swaps/testnet/${address}`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  // SQLite coordinates record reservations across processes. The JSON identity
  // store coordinates only calls in this process, so hold a separate run lock.
  // Run no other trader for this account while this example owns its stores.
  const lockPath = resolve(directory, 'run.lock')
  await createMarker(lockPath, 'Stop other runs before inspecting a stale lock')
  let store: Awaited<ReturnType<typeof sqliteRecordInventoryStore>> | undefined
  try {
    store = await sqliteRecordInventoryStore(resolve(directory, 'inventory.sqlite'))
    const { walletClient } = aleo.createAleoClient({
      privateKey,
      networkUrl: 'https://edge.provable.com/api/v2',
      provingMode: 'delegated', useFeeMaster: true, confirmationTimeout: 600_000,
      records: aleo.createRemoteScanner({ waitForSync: true }),
      // All calls through this client share the same record reservations.
      recordManagement: { enabled: true, store, chainId: 'aleo:testnet' },
    })
    const client = walletClient.extend(shieldSwapActions({
      api: {}, blindedIdentities: swapFileStore(resolve(directory, 'blinded.json')),
    }))
    await client.authenticateShieldSwap()

    // Resolve known submissions before planning. Missing confirmations remain
    // reserved; they are not evidence that a previous transaction failed.
    const journal = await client.reconcileRecordInventory()
    const unresolved = journal.filter((entry) => !['confirmed', 'rejected', 'cancelled'].includes(entry.status))
    if (unresolved.length) throw new Error(`Reconcile ${unresolved.length} unresolved operations in ${directory} before starting another batch`)
    const unclaimed = await client.getUnclaimedSwaps()
    if (unclaimed.swaps.length || unclaimed.unresolvable.length) throw new Error(`Recover previous swaps from ${directory}/blinded.json before starting another batch`)

    const token = await client.tokenData(from)
    const minimum = parseUnits(amountIn, token.decimals)
    if (minimum <= 0n) throw new Error('amountIn must be positive')
    // Six independent inputs let six swaps start at once. This distributes the
    // entire available token balance, leaving reservations untouched.
    const plan = await client.planInventory({
      token: token.id,
      target: { records: count, minRecordAmount: minimum, distribution: 'balanced', toleranceBps: 0 },
      maxTransactions: 24,
    })
    console.log(`${count} concurrent ${from} -> ${to} swaps, ${amountIn} ${from} each; recovery: ${directory}`)
    console.table(plan.steps.map((step) => ({ operation: step.kind, inputs: step.inputs.length, helper: step.joinProgram?.program ?? 'native' })))
    const preview = await client.quote({ from, to, amountIn, slippageBps: 50 })
    console.log(`Per swap: estimated ${formatUnits(preview.expectedOut, preview.to.decimals)} ${preview.to.symbol}; minimum ${formatUnits(preview.minOut, preview.to.decimals)} ${preview.to.symbol}`)
    if (!options.execute) {
      console.log('Preview only. Pass --execute to prepare records, submit swaps and claim outputs.')
      return { plan }
    }

    // Retain a marker on any failure or crash. A later invocation must not
    // silently repeat an interrupted batch; recovery is described in README.md.
    const pendingPath = resolve(directory, 'batch.pending')
    await createMarker(pendingPath, 'Resolve the previous batch before removing this file')
    const maintenance = await client.rebalanceRecordInventory({ plan, timeoutMs: 600_000, pollIntervalMs: 3_000 })
    if (maintenance.status !== 'complete') throw new Error(`Maintenance interrupted: ${maintenance.reason}; retain ${directory}`)

    // Quote after maintenance so joins and splits do not consume its lifetime.
    // Sharing an immutable quote preserves the same output floor on every call;
    // a quote does not reserve pool liquidity, so a trade can still fail.
    const offer = await client.quote({ from, to, amountIn, slippageBps: 50 })
    const batch = await submitConcurrentSwaps(client, Array(count).fill(offer))
    for (const [index, result] of batch.claims.entries()) {
      const handle = batch.handles[index]!
      if (result.status === 'fulfilled') {
        const claim = result.value
        console.log(`Swap ${handle.transactionId}: received ${formatUnits(claim.amountOut, offer.to.decimals)} ${offer.to.symbol}; refunded ${formatUnits(claim.amountRemaining, offer.from.decimals)} ${offer.from.symbol}`)
      } else {
        console.error(`Recover the claim for ${handle.transactionId} from ${directory}`)
      }
    }
    // Keep the pending marker until every swap and claim has succeeded. A later
    // run must resolve an uncertain transaction before starting another batch.
    const failures = [...batch.swaps, ...batch.claims].filter((result) => result.status === 'rejected')
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason), `${failures.length} operations need recovery in ${directory}; do not repeat the batch`)
    await unlink(pendingPath)
    return { plan, ...batch }
  } finally {
    store?.close()
    await unlink(lockPath)
  }
}

// Exclusive creation prevents a second run from replacing a lock or a pending
// batch marker. Only the caller that finishes the associated work removes it.
async function createMarker(path: string, instruction: string) {
  const file = await open(path, 'wx', 0o600).catch((cause: unknown) => {
    throw new Error(`Cannot create ${path}. ${instruction}.`, { cause })
  })
  await file.close()
}

// Keep imports side-effect free for tests and callers that supply their own terms.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    console.log('VEIL_E2E_PRIVATE_KEY must identify a funded testnet account. Run without flags to preview; --execute submits six 0.1 USDCx -> ETH swaps. See examples/shield-swap/README.md.')
  } else if (args.some((arg) => arg !== '--execute') || args.length > 1) {
    console.error('Usage: pnpm exec tsx examples/shield-swap/concurrent-swaps.ts [--execute | --help]')
    process.exitCode = 1
  } else {
    concurrentSwaps({ execute: args.includes('--execute') }).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : 'Concurrent swaps failed; retain the recovery directory')
      process.exitCode = 1
    })
  }
}
