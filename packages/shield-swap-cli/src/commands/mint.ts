/**
 * Mint — open a liquidity position and become the market for a pair.
 *
 * A position deposits both tokens over a price range. While the pool trades
 * inside that range the position earns a cut of every trade; outside it, it earns
 * nothing and sits in one token. The range is chosen here as a percentage either
 * side of the pool's current price, then aligned to the pool's tick spacing —
 * the contract only accepts bounds on that grid.
 *
 * `previewMint` does the arithmetic before anything is signed: the aligned
 * bounds, the liquidity the deposit backs, and — the number that matters — how
 * much of each token is actually consumed. A pair of amounts that balances at
 * one price falls short at another, so the mint takes only what the range needs
 * and the rest stays in the account.
 *
 * Tick insert hints are deliberately not passed. `mint` derives both, and for
 * the upper bound it applies a correction a caller cannot: finalize inserts
 * tick_lower before validating the upper hint, so when no initialized tick sits
 * between the bounds the upper predecessor is the just-inserted lower tick
 * rather than the one visible on chain. Passing an explicit `tickUpperHint`
 * disables that correction and reverts on exactly that case.
 *
 * SPENDS REAL FUNDS with --execute. Without it, prints the plan and stops.
 *
 * Usage:
 *   shield-swap mint --pair USDCx:ETH --percent 1
 *   shield-swap mint --pair USDCx:ETH --percent 1 --execute
 *   shield-swap mint --pair USDCx:ETH --amount0 0.5 --amount1 0.0002 --execute
 *   shield-swap mint --pool <poolKey> --percent 1 --range-pct 10 --execute
 *   shield-swap mint --pair USDCx:ETH --percent 1 --json
 */
import { loadSession, formatAmount, namedAmounts, pollUntil } from '../session.js'
import { flags, step, done, warn, output, confirmed, run, fail } from '../shared.js'

const USAGE = `shield-swap mint — open a liquidity position

  --pair <symbol:symbol>        pool to enter, e.g. USDCx:ETH  (or --pool)
  --pool <poolKey>              exact pool, skipping pair lookup
  --amount <symbol>:<decimal>   how much of one named token, e.g. USDCx:0.5.
                                Repeatable, once per side. Prefer this — it does
                                not depend on knowing the pool's token order
  --amount0 <decimal>           token0 to commit, in human units
  --amount1 <decimal>           token1 to commit, in human units
  --percent <n>                 commit n% of the private balance of both sides
  --range-pct <n>               range half-width around the price, default 5
  --network <testnet|mainnet>   default testnet
  --execute                     actually submit
  --json                        machine-readable output

Either --percent or at least one amount. A side left unnamed commits its whole
private balance as a ceiling — the plan shows what the range actually consumes,
which is never more than that.

--amount0/--amount1 follow the POOL's token order, which is fixed on chain and
need NOT match the order in --pair: naming --pair USDCx:ETH does not make USDCx
side 0. --amount names the token instead and cannot be transposed. The plan names
both symbols either way.`

/**
 * Runs the `mint` subcommand.
 *
 * @param argv Arguments after the subcommand name, as the dispatcher supplies them.
 */
export async function main(argv: string[]): Promise<void> {
  const args = flags(
    {
      pair: { type: 'string' },
      pool: { type: 'string' },
      amount: { type: 'string', multiple: true },
      amount0: { type: 'string' },
      amount1: { type: 'string' },
      percent: { type: 'string' },
      'range-pct': { type: 'string' },
    },
    USAGE,
    argv,
  )

  if (!args.pair && !args.pool) fail(`--pair or --pool is required.\n\n${USAGE}`)
  const bySymbol = (args.amount as string[] | undefined) ?? []
  const anyAmount = bySymbol.length > 0 || !!args.amount0 || !!args.amount1
  if (!args.percent && !anyAmount) {
    fail(`--percent, --amount, --amount0, or --amount1 is required.\n\n${USAGE}`)
  }
  if (args.percent && anyAmount) {
    fail(`--percent and the amount flags are alternatives, not both.\n\n${USAGE}`)
  }

  const percent = args.percent ? Number(args.percent) : undefined
  if (percent !== undefined && (!(percent > 0) || percent > 100)) {
    fail(`--percent must be greater than 0 and at most 100, got ${args.percent as string}`)
  }

  /** Basis points of a whole, so `--percent 12.5` is exact rather than rounded to 12. */
  const share = (total: bigint, pct: number) => (total * BigInt(Math.round(pct * 100))) / 10_000n

  await run(async () => {
    const { client, account, network } = await loadSession({ network: args.network as string | undefined })
    done(`session on ${network}`)

    // Resolve the pool first: every amount below is denominated in the pool's own
    // token0/token1 order, which is fixed on chain and need not match --pair.
    let poolKey = args.pool as string | undefined
    if (!poolKey) {
      const [left, right] = (args.pair as string).split(':')
      if (!left || !right) throw new Error(`"${args.pair as string}" is not symbol:symbol, e.g. USDCx:ETH`)
      const [a, b] = await Promise.all([client.tokenData(left), client.tokenData(right)])
      step(`looking for a ${a.symbol}/${b.symbol} pool`)
      const listed = (await client.api.getPools({ limit: 100 })).data as Array<{
        key: string
        token0: string
        token1: string
      }>
      const matches = listed.filter(
        (pool) =>
          (pool.token0 === a.id && pool.token1 === b.id) || (pool.token0 === b.id && pool.token1 === a.id),
      )
      if (!matches.length) {
        throw new Error(
          `no pool pairs ${a.symbol} with ${b.symbol} on ${network}. Run \`shield-swap pools\` to see what exists.`,
        )
      }
      // A pair can have several pools, one per fee tier. The deepest is the one a
      // trader would route through, so it is the one worth providing to.
      const withDepth = await Promise.all(
        matches.map(async (pool) => ({ pool, liquidity: (await client.getSlot({ poolKey: pool.key }))?.liquidity ?? 0n })),
      )
      withDepth.sort((x, y) => (y.liquidity > x.liquidity ? 1 : y.liquidity < x.liquidity ? -1 : 0))
      poolKey = withDepth[0]!.pool.key
      if (matches.length > 1) done(`${matches.length} fee tiers pair them — taking the deepest`)
    }

    const pool = await client.getPool({ poolKey })
    if (!pool) throw new Error(`no pool ${poolKey} on ${network} — check the key with \`shield-swap pools\`.`)

    // A mint the control gates would reject reverts on finalize and still costs a
    // fee, so the gates are read before the plan rather than discovered after it.
    const controls = await client.getTradeControls({ poolKey })
    if (!controls.tradeable) {
      throw new Error(
        `pool ${poolKey} is gated on chain right now (global pause ${controls.globalPaused}, ` +
          `pool enabled ${controls.poolEnabled}, pair paused ${controls.pairPaused}) — a mint would revert.`,
      )
    }

    const tokens = await client.listTokens()
    const infoOf = (id: string) => tokens.find((token) => token.id === id)
    const token0 = infoOf(pool.token0)
    const token1 = infoOf(pool.token1)
    if (!token0 || !token1) throw new Error(`the registry does not describe both tokens of pool ${poolKey}.`)

    // Private records fund a deposit; the public balance cannot be minted from.
    step('reading private balances for both sides')
    const balances = await client.getBalances({ tokens: [token0.id, token1.id] })
    const held0 = balances[token0.id]?.private ?? 0n
    const held1 = balances[token1.id]?.private ?? 0n
    if (held0 === 0n || held1 === 0n) {
      throw new Error(
        `an in-range position needs both sides, and this account holds ` +
          `${formatAmount(held0, token0.decimals, token0.symbol)} and ` +
          `${formatAmount(held1, token1.decimals, token1.symbol)} privately. Fund the empty side first.`,
      )
    }

    // The budget is a ceiling, not the deposit: the preview below reports what the
    // range consumes out of it.
    const named = namedAmounts({
      entries: bySymbol,
      indexed: [args.amount0 as string | undefined, args.amount1 as string | undefined],
      tokens: [token0, token1],
    })
    const budget0 = percent ? share(held0, percent) : (named.amount0 ?? held0)
    const budget1 = percent ? share(held1, percent) : (named.amount1 ?? held1)
    if (budget0 > held0 || budget1 > held1) {
      throw new Error(
        `asked to commit ${formatAmount(budget0, token0.decimals, token0.symbol)} / ` +
          `${formatAmount(budget1, token1.decimals, token1.symbol)} but the account holds ` +
          `${formatAmount(held0, token0.decimals, token0.symbol)} / ` +
          `${formatAmount(held1, token1.decimals, token1.symbol)} privately.`,
      )
    }

    const rangePercent = args['range-pct'] ? Number(args['range-pct']) : 5
    step(`pricing a ±${rangePercent}% range against the pool's live price`)
    const preview = await client.previewMint({
      poolKey,
      amount0Desired: budget0,
      amount1Desired: budget1,
      rangePercent,
    })
    if (preview.liquidity === 0n) {
      throw new Error(
        `that budget backs no liquidity over ticks ${preview.tickLower}…${preview.tickUpper} — ` +
          'commit more, or narrow the range with --range-pct. A mint would cost a fee and open nothing.',
      )
    }
    if (!preview.inRange) {
      warn(
        `the pool trades at tick ${preview.tickCurrent}, outside ${preview.tickLower}…${preview.tickUpper}: ` +
          'this position earns nothing until the price moves into its range, and is funded from one side only',
      )
    }
    if (preview.feeTierSpacing !== null && preview.feeTierSpacing !== preview.tickSpacing) {
      warn(
        `the pool's tick spacing (${preview.tickSpacing}) differs from what fee tier ${preview.fee} binds ` +
          `(${preview.feeTierSpacing}) — the bounds follow the pool, which is what the contract aligns to`,
      )
    }

    // Each side is funded from ONE record, not the sum of several, so a balance
    // large enough in total can still be too fragmented to mint from.
    const perSide = [
      { info: token0, needed: preview.amount0, held: held0 },
      { info: token1, needed: preview.amount1, held: held1 },
    ]
    for (const side of perSide) {
      if (side.needed > side.held) {
        throw new Error(
          `the range needs ${formatAmount(side.needed, side.info.decimals, side.info.symbol)} but only ` +
            `${formatAmount(side.held, side.info.decimals, side.info.symbol)} is held privately.`,
        )
      }
    }

    const planLines: Array<readonly [string, string]> = [
      ['pool', `${token0.symbol}/${token1.symbol}  fee ${preview.fee}  spacing ${preview.tickSpacing}`],
      [
        'range',
        `ticks ${preview.tickLower}…${preview.tickUpper} (±${rangePercent}%, price at tick ${preview.tickCurrent})`,
      ],
      ['status', preview.inRange ? 'in range — earns fees immediately' : 'OUT OF RANGE — earns nothing yet'],
      ['deposit', formatAmount(preview.amount0, token0.decimals, token0.symbol)],
      // Empty label: the second side of the same deposit, not a separate step.
      ['', formatAmount(preview.amount1, token1.decimals, token1.symbol)],
      [
        'unused',
        `${formatAmount(budget0 - preview.amount0, token0.decimals, token0.symbol)} / ` +
          `${formatAmount(budget1 - preview.amount1, token1.decimals, token1.symbol)} of the budget stays in the account`,
      ],
      ['owner', `${account.address} (also the withdrawal address collect pays)`],
    ]
    if (!confirmed({ execute: args.execute as boolean | undefined, network, plan: planLines })) {
      output({ network, submitted: false, poolKey, preview }, () => {})
      return
    }

    // Both token programs' sources: the prover cannot discover the dynamically
    // dispatched IARC20 callees on its own.
    const imports = await client.resolveDexImports({
      tokenPrograms: [token0.ammTokenProgram, token1.ammTokenProgram].filter((program): program is string => !!program),
    })

    step('proving and submitting the mint — this takes a minute or two')
    // No amount0Min/amount1Min: the contract takes at most the desired amounts, so
    // a price that moves between the preview and the finalize deposits slightly
    // less rather than more. A min would turn that into a revert.
    const minted = await client.mint({
      poolKey,
      tickLower: preview.tickLower,
      tickUpper: preview.tickUpper,
      amount0Desired: preview.amount0,
      amount1Desired: preview.amount1,
      recipient: account.address,
      withdrawal: account.address,
      imports,
    })
    done(`mint landed: tx ${minted.transactionId}`)
    if (!minted.positionTokenId) {
      // Only reachable on a wallet signer without the WASM peer; a local key
      // always gets the id back as a public output.
      warn('the position id was not returned — find it with `shield-swap positions`')
      output({ network, submitted: true, poolKey, transactionId: minted.transactionId, preview }, () => {})
      return
    }
    step(`position ${minted.positionTokenId} — waiting for the positions mapping to catch up`)

    // Mapping writes propagate to reads asynchronously, so the entry is expected
    // to be absent for a few seconds after the transaction confirms.
    let onchain: NonNullable<Awaited<ReturnType<typeof client.getPosition>>> | undefined
    const appeared = await pollUntil(
      async () => {
        const position = await client.getPosition({ positionTokenId: minted.positionTokenId! })
        if (position) onchain = position
        return position !== null
      },
      20,
      3_000,
    )
    if (appeared) done(`chain carries the position with liquidity ${onchain!.liquidity}`)
    else warn('the position has not appeared in the positions mapping yet — check `shield-swap positions` shortly')

    output(
      {
        network,
        submitted: true,
        poolKey,
        positionTokenId: minted.positionTokenId,
        transactionId: minted.transactionId,
        tickLower: preview.tickLower,
        tickUpper: preview.tickUpper,
        deposited0: preview.amount0,
        deposited1: preview.amount1,
        predictedLiquidity: preview.liquidity,
        liquidity: onchain?.liquidity ?? null,
      },
      (data) => {
        console.log(`\nPosition ${data.positionTokenId} open on ${token0.symbol}/${token1.symbol}.`)
        console.log(
          `Deposited ${formatAmount(data.deposited0, token0.decimals, token0.symbol)} and ` +
            `${formatAmount(data.deposited1, token1.decimals, token1.symbol)} over ticks ` +
            `${data.tickLower}…${data.tickUpper}.`,
        )
        console.log('Track it with `shield-swap positions`; collect earnings with `shield-swap collect`.')
      },
    )
  })
}
