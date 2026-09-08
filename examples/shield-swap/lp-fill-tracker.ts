/**
 * This example follows one or more liquidity positions' swap fills — the change
 * in token0 and token1 backing each position's fixed liquidity across each pool
 * swap — first as a replay of recent history, then live as new swaps land.
 *
 * The work is done by the SDK's `watchPositionFills` action, which combines
 * four data sources:
 *
 * 1. The on-chain position supplies its pool, tick range, and liquidity.
 * 2. REST trade history supplies each swap's ending square-root price.
 * 3. Aleo blocks establish block, transaction, and multi-hop leg order.
 * 4. WebSocket messages announce when REST may have new trades to backfill.
 *
 * Set the account private key, then pass one or more position token ids when
 * starting the tracker:
 *
 * ```sh
 * export VEIL_E2E_PRIVATE_KEY='APrivateKey1...'
 * pnpm exec tsx examples/shield-swap/lp-fill-tracker.ts <position-token-id> [<position-token-id>...]
 * pnpm exec tsx examples/shield-swap/lp-fill-tracker.ts <position-token-id> --network testnet
 * pnpm exec tsx examples/shield-swap/lp-fill-tracker.ts <position-token-id> --history 50
 * pnpm exec tsx examples/shield-swap/lp-fill-tracker.ts <position-token-id> --from-block 19400000
 * ```
 *
 * Mainnet is the default. Pass `--network testnet` to track a testnet
 * position. The tracker replays 20 fills per pool by default, or every fill
 * since `--from-block`. Inventory fills do not represent the position's accrued
 * fees — `getOwnedPosition` reports those.
 */
import { PositionTrackingError, shieldSwapActions } from '../../packages/shield-swap/src/index.js'
import { createClient, http, publicActions } from '../../packages/core/src/index.js'
import { loadNetwork } from '../../packages/provable-sdk/src/index.js'

/**
 * Configures liquidity-position tracking.
 *
 * @property positionTokenIds Token ids of the position NFTs to track.
 * @property network Aleo network containing the positions. Defaults to
 *   `mainnet`.
 * @property history Number of recent fills per pool to replay before going
 *   live. Defaults to `20` unless `fromBlock` is set.
 * @property fromBlock Replay every fill from this block height instead.
 * @property watch Continue following the pools after the replay. Defaults to
 *   `true`; set to `false` for a one-shot report.
 */
export type TrackLiquidityPositionOptions = {
  positionTokenIds: string[]
  network?: 'mainnet' | 'testnet'
  history?: number
  fromBlock?: number
  watch?: boolean
}

/**
 * Tracks liquidity positions' recent and live token inventory changes.
 *
 * Builds an authenticated Shield Swap client from `VEIL_E2E_PRIVATE_KEY`, then
 * either prints a one-shot replay (`watch: false`) or streams fills until every
 * position has changed or been closed. Signs the Shield Swap authentication
 * challenge but does not prove or submit transactions.
 *
 * @param options Selects the positions, network, replay window, and whether
 *   tracking continues after the replay.
 * @returns When `watch` is `false`, resolves after the replay; otherwise
 *   resolves when the watch has dropped every position.
 * @throws If the private key is missing, or the replay fails.
 *
 * @example
 * ```ts
 * await trackLiquidityPosition({ positionTokenIds: ['11field'] })
 *
 * // Replay the latest 50 fills per pool, then stop.
 * await trackLiquidityPosition({ positionTokenIds: ['11field', '12field'], history: 50, watch: false })
 * ```
 */
export async function trackLiquidityPosition(options: TrackLiquidityPositionOptions): Promise<void> {
  const { positionTokenIds, network = 'mainnet', history, fromBlock } = options

  const privateKey = process.env.VEIL_E2E_PRIVATE_KEY
  if (!privateKey) throw new Error('VEIL_E2E_PRIVATE_KEY is required to authenticate with Shield Swap.')

  const aleo = await loadNetwork(network)
  const client = createClient({
    account: aleo.privateKeyToAccount(privateKey),
    transport: http('https://api.provable.com/v2', { network }),
  })
    .extend(publicActions)
    .extend(shieldSwapActions({ api: {} }))
  await client.authenticateShieldSwap()

  if (options.watch === false) {
    const result = await client.getPositionFills({ positionTokenIds, history, fromBlock })
    for (const position of result.positions) {
      console.log(
        `position ${position.positionTokenId}`,
        `pool ${position.poolKey}`,
        `range [${position.tickLower}, ${position.tickUpper})`,
        `liquidity ${position.liquidity}`,
        `measured from tick ${position.start.tick}`,
      )
    }
    for (const fill of result.fills) console.log(fill)
    return
  }

  // The watch drops a position when its range or liquidity changes, since fills
  // can no longer be attributed; this promise resolves once none remain.
  await new Promise<void>((resolve) => {
    let remaining = new Set(positionTokenIds).size
    client.watchPositionFills({
      positionTokenIds,
      history,
      fromBlock,
      onFill: (fill, { replayed }) => console.log(replayed ? 'replayed' : 'live', fill),
      onError: (error) => {
        if (error instanceof PositionTrackingError) {
          console.error('stopped tracking', error.positionTokenIds, error.message)
          remaining -= error.positionTokenIds.length
          if (remaining <= 0) resolve()
          return
        }
        console.warn('transient failure, retrying on the next poll:', error.message)
      },
    })
  })
}

if (process.argv[1]?.endsWith('lp-fill-tracker.ts')) {
  // Flags take one value each; everything else is a position token id.
  const args = process.argv.slice(2)
  const FLAGS = ['--network', '--history', '--from-block']
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name)
    return index === -1 ? undefined : args[index + 1]
  }
  // A flag at the end, or followed by another flag, has no value; treating it
  // as absent would silently fall back to a default.
  const valueless = FLAGS.find((name) => args.includes(name) && (flag(name) === undefined || flag(name)!.startsWith('--')))
  const network = flag('--network') ?? 'mainnet'
  const history = flag('--history') === undefined ? undefined : Number(flag('--history'))
  const fromBlock = flag('--from-block') === undefined ? undefined : Number(flag('--from-block'))
  const positionTokenIds = args.filter((arg, index) => !arg.startsWith('--') && !FLAGS.includes(args[index - 1] ?? ''))

  if (valueless) {
    console.error(`${valueless} requires a value.`)
    process.exitCode = 1
  } else if (network !== 'mainnet' && network !== 'testnet') {
    console.error('Network must be mainnet or testnet.')
    process.exitCode = 1
  } else if (history !== undefined && (!Number.isInteger(history) || history < 0)) {
    console.error('History must be a non-negative integer.')
    process.exitCode = 1
  } else if (fromBlock !== undefined && (!Number.isInteger(fromBlock) || fromBlock < 0)) {
    console.error('From-block must be a non-negative block height.')
    process.exitCode = 1
  } else if (history !== undefined && fromBlock !== undefined) {
    console.error('Pass either --history or --from-block, not both.')
    process.exitCode = 1
  } else if (!positionTokenIds.length) {
    console.error(
      'Usage: pnpm exec tsx examples/shield-swap/lp-fill-tracker.ts <position-token-id>... [--network mainnet|testnet] [--history N | --from-block H]',
    )
    process.exitCode = 1
  } else {
    void trackLiquidityPosition({ positionTokenIds, network, history, fromBlock }).catch((error: unknown) => {
      console.error(error)
      process.exitCode = 1
    })
  }
}
