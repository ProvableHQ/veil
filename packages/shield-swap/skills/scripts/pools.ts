/**
 * Pool discovery — what can be traded, and how deep it is.
 *
 * Lists the pools the API knows, then checks each against chain: the API can
 * list a pool the contract refuses to trade, so the tradeable flag and the live
 * liquidity come from the mappings rather than the index.
 *
 * Reads only. Spends nothing, needs no funded account, and works before setup
 * has run if a state file already carries a key.
 *
 * Usage:
 *   npx tsx pools.ts                          # testnet, human table
 *   npx tsx pools.ts --network mainnet        # mainnet
 *   npx tsx pools.ts --token USDCx            # only pools holding this token
 *   npx tsx pools.ts --sort liquidity         # deepest first (default)
 *   npx tsx pools.ts --limit 10 --json        # machine-readable
 */
import { loadSession } from './session.js'
import { flags, setJsonMode, step, done, output, run } from './cli.js'

const USAGE = `pools.ts — discover tradeable pools

  --network <testnet|mainnet>   default testnet
  --token <symbol|id>           only pools holding this token
  --sort <liquidity|fee>        default liquidity
  --limit <n>                   pools to inspect, default 50
  --json                        machine-readable output`

const args = flags({ token: { type: 'string' }, sort: { type: 'string' }, limit: { type: 'string' } }, USAGE)
setJsonMode(!!args.json)

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
  const filter = options.token ? await client.resolveToken(options.token) : undefined
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

  output({ network, pools: sorted }, (data) => {
    console.log(`\n${data.pools.length} pools on ${data.network}:\n`)
    for (const pool of data.pools) {
      const pair = `${pool.token0.symbol}/${pool.token1.symbol}`
      const mark = pool.tradeable ? ' ' : '×'
      console.log(
        `${mark} ${pair.padEnd(14)} fee ${String(pool.fee).padStart(6)}  ` +
          `spacing ${String(pool.tickSpacing).padStart(5)}  tick ${String(pool.tick).padStart(8)}  ` +
          `liquidity ${pool.liquidity}${pool.reason ? `  (${pool.reason})` : ''}`,
      )
      console.log(`    ${pool.poolKey}`)
    }
    const untradeable = data.pools.filter((pool) => !pool.tradeable).length
    if (untradeable) console.log(`\n× ${untradeable} listed but not tradeable right now.`)
    // Liquidity stays raw on purpose: it is not denominated in either token, so
    // rendering it with a token's decimals would misstate it.
    console.log('\nLiquidity is raw — it is not denominated in either token.')
  })
})
