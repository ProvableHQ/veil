/**
 * Pool discovery — what can be traded, and how deep it is.
 *
 * Lists the pools the API knows, then checks each against chain: the API can
 * list a pool the contract refuses to trade, so the tradeable flag and the live
 * liquidity come from the mappings rather than the index.
 *
 * Reads only. Spends nothing, needs no funded account, and works before setup
 * has run if a state file already carries a key. `--positions` is the exception:
 * it scans the account's own records, which needs a working record scanner.
 *
 * Usage:
 *   shield-swap pools                          # testnet, human table
 *   shield-swap pools --network mainnet        # mainnet
 *   shield-swap pools --token USDCx            # only pools holding this token
 *   shield-swap pools --positions              # add this account's stake per pool
 *   shield-swap pools --sort liquidity         # deepest first (default)
 *   shield-swap pools --limit 10 --json        # machine-readable
 */
import { loadSession } from '../session.js'
import { flags, step, done, warn, output, run, table } from '../shared.js'
import { green, yellow } from '../color.js'

/**
 * Renders a pool's fee tier as a percentage.
 *
 * The contract counts fees in pips out of 1,000,000 (`fee_pips`), so the raw
 * `800` a pool reports is 0.08% rather than 800 of anything a trader recognises.
 * Trailing zeros are dropped so the thinnest tiers stay legible. Pure and local.
 *
 * @param pips The pool's fee, as stored on chain.
 * @returns The tier as a percentage string, e.g. `'0.08%'`.
 */
function formatFee(pips: number): string {
  return `${(pips / 10_000).toFixed(4).replace(/\.?0+$/, '')}%`
}

const USAGE = `shield-swap pools — discover tradeable pools

  --network <testnet|mainnet>   default testnet
  --token <symbol|id>           only pools holding this token
  --positions                   add this account's stake in each pool
  --sort <liquidity|fee>        default liquidity
  --limit <n>                   pools to inspect, default 50
  --json                        machine-readable output`

/** A pool with the chain's opinion of it, not just the index's. */
export type PoolSummary = {
  poolKey: string
  token0: { id: string; symbol: string; decimals: number }
  token1: { id: string; symbol: string; decimals: number }
  fee: number
  tickSpacing: number
  tick: number
  liquidity: bigint
  tradeable: boolean
  reason?: string
}

/**
 * What the account holds in one pool, measured the way the pool measures it.
 *
 * @property positions Position records the account holds in this pool, including
 *   any counted by `noChainEntry`.
 * @property outOfRange How many sit outside the current price. Those earn nothing
 *   and contribute nothing to the pool's active liquidity.
 * @property noChainEntry How many have no entry in the positions mapping — a mint
 *   still finalizing, or one already burned whose record the scanner still serves.
 *   Neither holds liquidity, so they are classified as neither in nor out of range.
 * @property liquidity In-range liquidity only, so it is comparable to the pool's
 *   own figure.
 * @property shareBps In-range liquidity as basis points of the pool's active
 *   liquidity, or `null` when the pool has none to divide by.
 */
export type PoolStake = {
  positions: number
  outOfRange: number
  noChainEntry: number
  liquidity: bigint
  shareBps: number | null
}

/**
 * Sums the account's positions per pool, counting only what the pool counts.
 *
 * A position's liquidity is part of a pool's active liquidity only while the
 * price sits inside its range — outside it the position is idle. Summing every
 * position regardless would overstate the account's share of a pool it currently
 * earns nothing from, so out-of-range positions are counted separately rather
 * than added in.
 *
 * Scans the account's records, which needs a record scanner. One scan covers
 * every pool.
 *
 * @param client A composed shield-swap client.
 * @param pools The pools to attribute stakes to. Positions in any other pool are
 *   ignored, and the count of those is returned so the caller can say so.
 * @returns Stakes keyed by pool key, and how many positions fell outside `pools`.
 */
async function stakePerPool(
  client: Awaited<ReturnType<typeof loadSession>>['client'],
  pools: PoolSummary[],
): Promise<{ stakes: Map<string, PoolStake>; elsewhere: number }> {
  const owned = await client.getOwnedPositions()
  const byKey = new Map(pools.map((pool) => [pool.poolKey, pool]))
  const stakes = new Map<string, PoolStake>()
  let elsewhere = 0

  for (const position of owned) {
    const pool = byKey.get(position.poolKey)
    if (!pool) {
      elsewhere += 1
      continue
    }
    const stake =
      stakes.get(position.poolKey) ??
      { positions: 0, outOfRange: 0, noChainEntry: 0, liquidity: 0n, shareBps: null }
    stake.positions += 1
    if (position.state === null) {
      // No mapping entry means it holds no liquidity at all, so calling it
      // in-range would imply it is earning and calling it out-of-range would
      // imply it could be brought back in. It is neither.
      stake.noChainEntry += 1
    } else if (position.tickLower <= pool.tick && pool.tick < position.tickUpper) {
      // Upper bound exclusive, matching the contract: at exactly tick_upper the
      // position is already out of range.
      stake.liquidity += position.state.liquidity
    } else stake.outOfRange += 1
    stakes.set(position.poolKey, stake)
  }

  for (const [poolKey, stake] of stakes) {
    const active = byKey.get(poolKey)?.liquidity ?? 0n
    stake.shareBps = active > 0n ? Number((stake.liquidity * 10_000n) / active) : null
  }
  return { stakes, elsewhere }
}

/**
 * Discovers pools and joins each with its chain state.
 *
 * @param client A composed shield-swap client.
 * @param options.token Symbol or id to filter by.
 * @param options.limit Pools to inspect.
 * @returns One summary per pool, deepest first unless sorted otherwise.
 */
export async function discoverPools(
  client: Awaited<ReturnType<typeof loadSession>>['client'],
  options: { token?: string; limit?: number } = {},
): Promise<PoolSummary[]> {
  const filter = options.token ? await client.tokenData(options.token) : undefined
  if (filter) step(`filtering to ${filter.symbol} (${filter.id})`)

  step('reading the pool index')
  const listed = (await client.api.getPools({ limit: options.limit ?? 50 })).data as Array<{
    key: string
    token0: string
    token1: string
  }>
  const tokens = await client.listTokens()
  const infoOf = (id: string) => tokens.find((token) => token.id === id)

  const relevant = filter
    ? listed.filter((pool) => pool.token0 === filter.id || pool.token1 === filter.id)
    : listed
  step(`inspecting ${relevant.length} of ${listed.length} pools on chain`)

  const summaries: PoolSummary[] = []
  for (const pool of relevant) {
    // Both gates matter and neither is in the index: a pool can be listed and
    // paused, or listed with no liquidity to trade against.
    const [onchain, slot, controls] = await Promise.all([
      client.getPool({ poolKey: pool.key }),
      client.getSlot({ poolKey: pool.key }),
      client.getTradeControls({ poolKey: pool.key }),
    ])
    if (!onchain || !slot) continue

    const t0 = infoOf(pool.token0)
    const t1 = infoOf(pool.token1)
    summaries.push({
      poolKey: pool.key,
      token0: { id: pool.token0, symbol: t0?.symbol ?? '?', decimals: t0?.decimals ?? 0 },
      token1: { id: pool.token1, symbol: t1?.symbol ?? '?', decimals: t1?.decimals ?? 0 },
      fee: onchain.fee,
      tickSpacing: slot.tick_spacing,
      tick: slot.tick,
      liquidity: slot.liquidity,
      tradeable: controls.tradeable && slot.liquidity > 0n,
      ...(controls.tradeable
        ? slot.liquidity > 0n
          ? {}
          : { reason: 'no liquidity' }
        : { reason: 'paused or gated on chain' }),
    })
  }
  return summaries
}

/**
 * Runs the `pools` subcommand.
 *
 * @param argv Arguments after the subcommand name, as the dispatcher supplies them.
 */
export async function main(argv: string[]): Promise<void> {
  const args = flags(
    {
      token: { type: 'string' },
      positions: { type: 'boolean' },
      sort: { type: 'string' },
      limit: { type: 'string' },
    },
    USAGE,
    argv,
  )

  await run(async () => {
    const { client, network } = await loadSession({ network: args.network as string | undefined })
    done(`session on ${network}`)

    const pools = await discoverPools(client, {
      ...(args.token ? { token: args.token as string } : {}),
      ...(args.limit ? { limit: Number(args.limit) } : {}),
    })
    const sorted =
      args.sort === 'fee'
        ? [...pools].sort((a, b) => a.fee - b.fee)
        : [...pools].sort((a, b) => (b.liquidity > a.liquidity ? 1 : b.liquidity < a.liquidity ? -1 : 0))

    let stakes: Map<string, PoolStake> | undefined
    if (args.positions) {
      step('scanning position records to attribute a stake to each pool')
      const mine = await stakePerPool(client, sorted)
      stakes = mine.stakes
      // Said rather than swallowed: a position in a pool this listing filtered out
      // is invisible here, and a zero stake would otherwise read as "none held".
      if (mine.elsewhere) {
        warn(
          `${mine.elsewhere} position(s) are in pools outside this listing — widen --limit or drop --token to see them`,
        )
      }
    }

    output(
      {
        network,
        pools: sorted.map((pool) => ({
          ...pool,
          ...(stakes ? { stake: stakes.get(pool.poolKey) ?? null } : {}),
        })),
      },
      (data) => {
        if (!data.pools.length) {
          // A bare header and rule reads as a rendering fault rather than an empty
          // result, and the filter is the likeliest reason there is nothing to show.
          console.log(
            args.token
              ? `\nNo pools hold ${args.token as string} on ${data.network}. Drop --token to see every pool.`
              : `\nNo pools on ${data.network}.`,
          )
          return
        }
        const headers = ['PAIR', 'FEE', 'SPACING', 'TICK', 'LIQUIDITY', 'STATUS', 'POOL KEY']
        const align: Array<'left' | 'right'> = ['left', 'right', 'right', 'right', 'right', 'left', 'left']
        if (stakes) {
          // Inserted before POOL KEY, which is long enough to push anything after
          // it off a narrow terminal.
          headers.splice(5, 0, 'POSITIONS', 'MY LIQUIDITY', 'SHARE')
          align.splice(5, 0, 'right', 'right', 'right')
        }
        table(
          headers,
          data.pools.map((pool) => {
            const row = [
              `${pool.token0.symbol}/${pool.token1.symbol}`,
              formatFee(pool.fee),
              String(pool.tickSpacing),
              String(pool.tick),
              // Liquidity stays raw on purpose: it is not denominated in either
              // token, so rendering it with a token's decimals would misstate it.
              pool.liquidity.toString(),
              // Green reads as "you can trade this now"; a reason is always a
              // reason it is unavailable, so it takes the warning colour.
              pool.reason ? yellow(pool.reason) : green('tradeable'),
              pool.poolKey,
            ]
            if (stakes) {
              const stake = stakes.get(pool.poolKey)
              // Both qualifiers are named in the cell rather than a footnote: a bare
              // count next to a share of 0.11% invites the reading that every
              // position is working, when one may be idle and another not on chain.
              const notes = stake
                ? [
                    ...(stake.outOfRange ? [`${stake.outOfRange} out`] : []),
                    ...(stake.noChainEntry ? [`${stake.noChainEntry} no entry`] : []),
                  ]
                : []
              row.splice(
                5,
                0,
                stake ? `${stake.positions}${notes.length ? ` (${notes.join(', ')})` : ''}` : '—',
                stake && stake.liquidity > 0n ? stake.liquidity.toString() : '—',
                stake?.shareBps == null ? '—' : `${(stake.shareBps / 100).toFixed(2)}%`,
              )
            }
            return row
          }),
          align,
        )
      },
    )
  })
}
