/**
 * This example follows a liquidity position's swap fills — the change in token0
 * and token1 backing its fixed liquidity across each pool swap — first as a
 * replay of recent history, then live as new swaps land.
 *
 * The work is done by the SDK's `watchPositionFills` action, which combines
 * four data sources:
 *
 * 1. The on-chain position supplies its pool, tick range, and liquidity.
 * 2. REST trade history supplies each swap's ending square-root price.
 * 3. Aleo blocks establish block, transaction, and multi-hop leg order.
 * 4. WebSocket messages announce when REST may have new trades to backfill.
 *
 * Set the account private key, then pass the position token id when starting
 * the tracker:
 *
 * ```sh
 * export VEIL_E2E_PRIVATE_KEY='APrivateKey1...'
 * pnpm exec tsx examples/shield-swap/lp-fill-tracker.ts <position-token-id>
 * pnpm exec tsx examples/shield-swap/lp-fill-tracker.ts <position-token-id> --network testnet
 * pnpm exec tsx examples/shield-swap/lp-fill-tracker.ts <position-token-id> --history 50
 * ```
 *
 * Mainnet is the default. Pass `--network testnet` to track a testnet
 * position. The tracker replays 20 fills by default. Inventory fills do not
 * represent the position's accrued fees — `getOwnedPosition` reports those.
 */
import { PositionTrackingError, shieldSwapActions } from '../../packages/shield-swap/src/index.js'
import { createClient, http, publicActions } from '../../packages/core/src/index.js'
import { loadNetwork } from '../../packages/provable-sdk/src/index.js'

/**
 * Configures liquidity-position tracking.
 *
 * @property positionTokenId Token id of the position NFT to track.
 * @property network Aleo network containing the position. Defaults to
 *   `mainnet`.
 * @property history Number of recent fills to replay before going live.
 *   Defaults to `20`.
 * @property watch Continue following the pool after the replay. Defaults to
 *   `true`; set to `false` for a one-shot report.
 */
export type TrackLiquidityPositionOptions = {
  positionTokenId: string
  network?: 'mainnet' | 'testnet'
  history?: number
  watch?: boolean
}

/**
 * Tracks a liquidity position's recent and live token inventory changes.
 *
 * Builds an authenticated Shield Swap client from `VEIL_E2E_PRIVATE_KEY`, then
 * either prints a one-shot replay (`watch: false`) or streams fills until the
 * position changes. Signs the Shield Swap authentication challenge but does not
 * prove or submit transactions.
 *
 * @param options Selects the position, network, replay depth, and whether
 *   tracking continues after the replay.
 * @returns When `watch` is `false`, resolves after the replay; otherwise
 *   resolves when the watch stops itself.
 * @throws If the private key is missing, or the replay fails.
 *
 * @example
 * ```ts
 * await trackLiquidityPosition({ positionTokenId: '11field' })
 *
 * // Replay the latest 50 fills, then stop.
 * await trackLiquidityPosition({ positionTokenId: '11field', history: 50, watch: false })
 * ```
 */
export async function trackLiquidityPosition(options: TrackLiquidityPositionOptions): Promise<void> {
  const { positionTokenId, network = 'mainnet', history = 20 } = options

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
    const result = await client.getPositionFills({ positionTokenId, history })
    console.log(
      `position ${positionTokenId}`,
      `pool ${result.poolKey}`,
      `range [${result.tickLower}, ${result.tickUpper})`,
      `liquidity ${result.liquidity}`,
      `measured from tick ${result.start.tick}`,
    )
    for (const fill of result.fills) console.log(fill)
    return
  }

  // The watch resolves this promise only when it stops itself: the position's
  // range or liquidity changed, so fills can no longer be attributed.
  await new Promise<void>((resolve) => {
    client.watchPositionFills({
      positionTokenId,
      history,
      onFill: (fill, { replayed }) => console.log(replayed ? 'replayed' : 'live', fill),
      onError: (error) => {
        if (error instanceof PositionTrackingError) {
          console.error('fill tracking stopped:', error.message)
          resolve()
          return
        }
        console.warn('transient failure, retrying on the next poll:', error.message)
      },
    })
  })
}

if (process.argv[1]?.endsWith('lp-fill-tracker.ts')) {
  const positionTokenId = process.argv[2]
  const networkFlagIndex = process.argv.indexOf('--network')
  const network = networkFlagIndex === -1 ? 'mainnet' : process.argv[networkFlagIndex + 1]
  const historyFlagIndex = process.argv.indexOf('--history')
  const history = historyFlagIndex === -1 ? 20 : Number(process.argv[historyFlagIndex + 1])

  if (network !== 'mainnet' && network !== 'testnet') {
    console.error('Network must be mainnet or testnet.')
    process.exitCode = 1
  } else if (!Number.isInteger(history) || history < 0) {
    console.error('History must be a non-negative integer.')
    process.exitCode = 1
  } else if (!positionTokenId) {
    console.error(
      'Usage: pnpm exec tsx examples/shield-swap/lp-fill-tracker.ts <position-token-id> [--network mainnet|testnet] [--history N]',
    )
    process.exitCode = 1
  } else {
    void trackLiquidityPosition({ positionTokenId, network, history }).catch((error: unknown) => {
      console.error(error)
      process.exitCode = 1
    })
  }
}
