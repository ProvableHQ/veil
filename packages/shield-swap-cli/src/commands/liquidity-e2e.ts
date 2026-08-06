/**
 * Liquidity round trip — mint, increase, decrease, collect, burn, in one run.
 *
 * The whole life of a position, end to end, as a trader would walk it. Useful as
 * a smoke test of a funded account against a live deployment, and as the shape to
 * copy when wiring the same sequence into an application.
 *
 * Five transactions, each depending on the one before, with two kinds of waiting
 * between them:
 *
 *   The positions mapping lags its own writes. A read taken straight after a
 *   confirmed transaction can still show the previous state, so each step polls
 *   for what it just changed before the next one builds on it.
 *
 *   The record scanner lags further. Every write spends the position record and
 *   issues a new one, and a write built on the spent record carries a serial
 *   number the chain has already consumed — the node drops it at verification, so
 *   it never reaches a block and the only symptom is a confirmation wait against
 *   a transaction nothing has heard of. Checking that a record exists is not
 *   enough, since the spent one satisfies that too; the record's tag has to
 *   change.
 *
 * A step that fails stops the run, because everything after it builds on what it
 * would have produced. The position is then left wherever the failure found it,
 * and the message says what it holds and which script recovers it.
 *
 * SPENDS REAL FUNDS with --execute. Without it, prints the plan and stops.
 *
 * Usage:
 *   shield-swap liquidity-e2e                              # plan against the best-funded pool
 *   shield-swap liquidity-e2e --execute
 *   shield-swap liquidity-e2e --pair USDCx:ETH --percent 0.5 --execute
 *   shield-swap liquidity-e2e --pool <poolKey> --range-pct 10 --execute
 */
import { loadSession, formatAmount, pollUntil } from '../session.js'
import { flags, step, done, warn, output, confirmed, run, fail } from '../shared.js'

const USAGE = `shield-swap liquidity-e2e — the whole position lifecycle in one run

  --pair <symbol:symbol>        pool to use, e.g. USDCx:ETH
  --pool <poolKey>              exact pool
  --percent <n>                 share of the private balance of each side to
                                commit, default 0.1
  --range-pct <n>               range half-width around the price, default 5
  --network <testnet|mainnet>   default testnet
  --execute                     actually submit the five transactions
  --json                        machine-readable output

With neither --pair nor --pool, the deepest pool this account is funded on both
sides of is chosen. A completed run leaves nothing behind: the position it opens
is the position it burns.`

/**
 * Runs the `liquidity-e2e` subcommand.
 *
 * @param argv Arguments after the subcommand name, as the dispatcher supplies them.
 */
export async function main(argv: string[]): Promise<void> {
  const args = flags(
    {
      pair: { type: 'string' },
      pool: { type: 'string' },
      percent: { type: 'string' },
      'range-pct': { type: 'string' },
    },
    USAGE,
    argv,
  )

  const percent = args.percent ? Number(args.percent) : 0.1
  if (!(percent > 0) || percent > 100) {
    fail(`--percent must be greater than 0 and at most 100, got ${args.percent as string}`)
  }
  const rangePercent = args['range-pct'] ? Number(args['range-pct']) : 5

  /** Basis points of a whole, so `--percent 0.1` survives the conversion to bigint. */
  const share = (total: bigint, pct: number) => (total * BigInt(Math.round(pct * 100))) / 10_000n

  await run(async () => {
    const { client, account, network } = await loadSession({ network: args.network as string | undefined })
    done(`session on ${network} for ${account.address}`)

    const tokens = await client.listTokens()
    const infoOf = (id: string) => tokens.find((token) => token.id === id)
    const balances = await client.getBalances()
    const held = (id: string) => balances[id]?.private ?? 0n

    // ---- choose the pool -----------------------------------------------------
    let poolKey = args.pool as string | undefined
    if (!poolKey) {
      step('reading the pool index')
      const listed = (await client.api.getPools({ limit: 100 })).data as Array<{
        key: string
        token0: string
        token1: string
      }>
      let candidates = listed
      if (args.pair) {
        const [left, right] = (args.pair as string).split(':')
        if (!left || !right) throw new Error(`"${args.pair as string}" is not symbol:symbol, e.g. USDCx:ETH`)
        const [a, b] = await Promise.all([client.tokenData(left), client.tokenData(right)])
        candidates = listed.filter(
          (pool) =>
            (pool.token0 === a.id && pool.token1 === b.id) || (pool.token0 === b.id && pool.token1 === a.id),
        )
        if (!candidates.length) {
          throw new Error(
            `no pool pairs ${a.symbol} with ${b.symbol} on ${network}. Run \`shield-swap pools\` to see what exists.`,
          )
        }
      }
      // A mint needs both sides, so a pool funded on only one is unusable however
      // deep it is. Among the usable ones, the deepest: a thin pool moves price
      // sharply against the deposit.
      const funded = candidates.filter((pool) => held(pool.token0) > 0n && held(pool.token1) > 0n)
      if (!funded.length) {
        throw new Error(
          'this account is not funded on both sides of any listed pool. `shield-swap balances` shows what it ' +
            'holds; `shield-swap setup` can draw testnet funds.',
        )
      }
      step(`ranking ${funded.length} pool(s) this account can mint into`)
      const withDepth = await Promise.all(
        funded.map(async (pool) => ({ pool, liquidity: (await client.getSlot({ poolKey: pool.key }))?.liquidity ?? 0n })),
      )
      withDepth.sort((x, y) => (y.liquidity > x.liquidity ? 1 : y.liquidity < x.liquidity ? -1 : 0))
      poolKey = withDepth[0]!.pool.key
    }

    const pool = await client.getPool({ poolKey })
    if (!pool) throw new Error(`no pool ${poolKey} on ${network} — check the key with \`shield-swap pools\`.`)
    const token0 = infoOf(pool.token0)
    const token1 = infoOf(pool.token1)
    if (!token0 || !token1) throw new Error(`the registry does not describe both tokens of pool ${poolKey}.`)
    const pair = `${token0.symbol}/${token1.symbol}`

    // A gated pool reverts every one of the five transactions while still charging
    // for them, so the gates are read before anything is planned.
    const controls = await client.getTradeControls({ poolKey })
    if (!controls.tradeable) {
      throw new Error(
        `pool ${poolKey} is gated on chain right now (global pause ${controls.globalPaused}, pool enabled ` +
          `${controls.poolEnabled}, pair paused ${controls.pairPaused}) — every step of this run would revert.`,
      )
    }

    // ---- price the deposit ---------------------------------------------------
    const budget0 = share(held(pool.token0), percent)
    const budget1 = share(held(pool.token1), percent)
    step(`pricing ${percent}% of each side over a ±${rangePercent}% range`)
    const preview = await client.previewMint({
      poolKey,
      amount0Desired: budget0,
      amount1Desired: budget1,
      rangePercent,
    })
    if (preview.liquidity === 0n) {
      throw new Error(
        `${percent}% of this account's ${pair} balances backs no liquidity over ticks ` +
          `${preview.tickLower}…${preview.tickUpper}. Raise --percent, or narrow --range-pct.`,
      )
    }
    if (!preview.inRange) {
      warn(
        `the pool trades at tick ${preview.tickCurrent}, outside ${preview.tickLower}…${preview.tickUpper}: ` +
          'this run will still complete, but the position earns no fees while it sits out of range',
      )
    }

    const planLines: Array<readonly [string, string]> = [
      ['pool', `${pair}  fee ${preview.fee}  spacing ${preview.tickSpacing}`],
      ['range', `ticks ${preview.tickLower}…${preview.tickUpper} (${preview.inRange ? 'in range' : 'OUT OF RANGE'})`],
      [
        '1 mint',
        `${formatAmount(preview.amount0, token0.decimals, token0.symbol)} + ` +
          `${formatAmount(preview.amount1, token1.decimals, token1.symbol)}`,
      ],
      ['2 increase', 'the same amounts again'],
      ['3 decrease', 'all of the liquidity, booking it as owed'],
      ['4 collect', 'everything owed, paid to the withdrawal address'],
      ['5 burn', 'the emptied position'],
      ['owner', `${account.address} (also the withdrawal address)`],
    ]
    if (!confirmed({ execute: args.execute as boolean | undefined, network, plan: planLines })) {
      output({ network, submitted: false, poolKey, preview }, () => {})
      return
    }

    // Both token programs' sources: the prover cannot discover the dynamically
    // dispatched IARC20 callees on its own. Resolved once for the whole run.
    const imports = await client.resolveDexImports({
      tokenPrograms: [token0.ammTokenProgram, token1.ammTokenProgram].filter((program): program is string => !!program),
    })

    /** How far the run got, so a failure can say what is left behind. */
    const progress = { positionTokenId: '', liquidity: 0n, owed: false, burned: false }

    /** The positions mapping entry, as every wait below reports it. */
    type PositionEntry = NonNullable<Awaited<ReturnType<typeof client.getPosition>>>

    /**
     * Reports what a failure left on chain and how to get it back.
     *
     * Nothing is unrecoverable at any point in this sequence — the position holds
     * the deposit until something withdraws it — so the message names the script
     * that finishes the job rather than treating the funds as lost.
     */
    const recovery = (): string => {
      if (!progress.positionTokenId) return 'Nothing was opened, so nothing is left to recover.'
      const id = progress.positionTokenId
      if (progress.burned) return 'The position was already burned; nothing is left to recover.'
      if (progress.liquidity > 0n) {
        return (
          `Position ${id} is open with ${progress.liquidity} liquidity. Withdraw it with ` +
          `\`shield-swap liquidity --position ${id} --decrease --percent 100\`, then ` +
          `\`shield-swap collect --position ${id} --close\`.`
        )
      }
      if (progress.owed) {
        return `Position ${id} is drained and owed its deposit back — \`shield-swap collect --position ${id} --close\`.`
      }
      return `Position ${id} is empty and can be closed with \`shield-swap collect --position ${id} --close\`.`
    }

    /**
     * Polls the positions mapping until it shows what the last write changed.
     *
     * @param predicate What the entry must show, taking `null` for "no entry".
     * @param what Completes "the position did not … within 30s".
     * @throws When the read never caught up, since the next step would build on
     *   state that has not materialized.
     */
    const waitForPosition = async (
      predicate: (position: PositionEntry | null) => boolean,
      what: string,
    ): Promise<PositionEntry | null> => {
      // Written as a loop rather than through `pollUntil` because the entry itself
      // is the result, and the next step is built from it.
      for (let attempt = 0; attempt < 15; attempt++) {
        const position = await client.getPosition({ positionTokenId: progress.positionTokenId })
        if (predicate(position)) return position
        await new Promise((resolve) => setTimeout(resolve, 2_000))
      }
      throw new Error(`the position did not ${what} within 30s of the transaction landing. ${recovery()}`)
    }

    /**
     * Waits until the scanner serves a position record other than `staleTag`.
     *
     * @param staleTag The tag of the record the last write spent.
     * @returns The new record's tag, to pass here after the next write.
     * @throws When no newer record appears, since the next write would be built on
     *   the spent one and silently dropped by the node.
     */
    const waitForFreshRecord = async (staleTag?: string): Promise<string> => {
      let tag: string | undefined
      let lastError: unknown
      const indexed = await pollUntil(
        async () => {
          try {
            const current = await client.getOwnedPosition({ positionTokenId: progress.positionTokenId })
            if (current && current.record.tag !== staleTag) tag = current.record.tag
          } catch (error) {
            // The hosted scanner answers with intermittent 401s. A failed poll is
            // retried inside the window, and only the last failure is reported.
            lastError = error
          }
          return tag !== undefined
        },
        30,
        2_000,
      )
      if (!indexed || tag === undefined) {
        throw new Error(
          `the record scanner served no position record newer than the one the last write spent (60s), so ` +
            `the next transaction would be built on a spent record and dropped. ${recovery()}`,
          lastError instanceof Error ? { cause: lastError } : undefined,
        )
      }
      return tag
    }

    const transactions: Array<{ step: string; transactionId: string }> = []

    // ---- 1. mint -------------------------------------------------------------
    // Tick insert hints are deliberately not passed. `mint` derives both, and for
    // the upper bound it applies a correction a caller cannot: finalize inserts
    // tick_lower before validating the upper hint, so when no initialized tick sits
    // between the bounds the upper predecessor is the just-inserted lower tick
    // rather than the one visible on chain.
    step('1/5 minting the position — proving takes a minute or two')
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
    transactions.push({ step: 'mint', transactionId: minted.transactionId })
    if (!minted.positionTokenId) {
      throw new Error(
        `the mint landed (tx ${minted.transactionId}) but returned no position id, so the rest of this run ` +
          'cannot address it. Find it with `shield-swap positions` and continue with `shield-swap liquidity`.',
      )
    }
    progress.positionTokenId = minted.positionTokenId
    done(`minted ${minted.positionTokenId} (tx ${minted.transactionId})`)

    const opened = await waitForPosition((position) => position !== null, 'appear in the positions mapping')
    progress.liquidity = opened!.liquidity
    done(`chain carries ${progress.liquidity} liquidity (predicted ${preview.liquidity})`)
    let recordTag = await waitForFreshRecord()

    // ---- 2. increase ---------------------------------------------------------
    // Re-priced rather than reusing the mint's amounts: the pool has traded since,
    // and the balances have the mint's deposit taken out of them.
    const after = await client.getBalances({ tokens: [token0.id, token1.id] })
    const addition = await client.previewMint({
      poolKey,
      amount0Desired: share(after[token0.id]?.private ?? 0n, percent),
      amount1Desired: share(after[token1.id]?.private ?? 0n, percent),
      tickLower: preview.tickLower,
      tickUpper: preview.tickUpper,
    })
    if (addition.liquidity === 0n) {
      throw new Error(
        `there is not enough left to add a second time — ${percent}% of the remaining balance backs no ` +
          `liquidity over this range. ${recovery()}`,
      )
    }
    step(
      `2/5 adding ${formatAmount(addition.amount0, token0.decimals, token0.symbol)} + ` +
        `${formatAmount(addition.amount1, token1.decimals, token1.symbol)}`,
    )
    const increased = await client.increaseLiquidity({
      positionTokenId: progress.positionTokenId,
      poolKey,
      amount0Desired: addition.amount0,
      amount1Desired: addition.amount1,
      imports,
    })
    transactions.push({ step: 'increase', transactionId: increased.transactionId })
    done(`increase landed (tx ${increased.transactionId})`)

    const grown = await waitForPosition(
      (position) => (position?.liquidity ?? 0n) > progress.liquidity,
      'show the added liquidity',
    )
    progress.liquidity = grown!.liquidity
    done(`liquidity now ${progress.liquidity}`)
    recordTag = await waitForFreshRecord(recordTag)

    // ---- 3. decrease ---------------------------------------------------------
    step(`3/5 withdrawing all ${progress.liquidity} liquidity`)
    const decreased = await client.decreaseLiquidity({
      positionTokenId: progress.positionTokenId,
      poolKey,
      liquidityToRemove: progress.liquidity,
    })
    transactions.push({ step: 'decrease', transactionId: decreased.transactionId })
    done(`decrease landed (tx ${decreased.transactionId})`)

    const drained = await waitForPosition((position) => position?.liquidity === 0n, 'drop to zero liquidity')
    progress.liquidity = 0n
    progress.owed = drained!.tokens_owed0 > 0n || drained!.tokens_owed1 > 0n
    done(
      `owed back ${formatAmount(drained!.tokens_owed0, token0.decimals, token0.symbol)} + ` +
        `${formatAmount(drained!.tokens_owed1, token1.decimals, token1.symbol)} — a withdrawal books, it does not pay`,
    )
    recordTag = await waitForFreshRecord(recordTag)

    // ---- 4. collect ----------------------------------------------------------
    // Requested from what the decrease actually booked. With the liquidity at zero
    // there is nothing accruing on top, so the booked figure is the whole of it.
    step('4/5 collecting what the position is owed')
    const collected = await client.collect({
      positionTokenId: progress.positionTokenId,
      poolKey,
      amount0Requested: drained!.tokens_owed0,
      amount1Requested: drained!.tokens_owed1,
      imports,
    })
    transactions.push({ step: 'collect', transactionId: collected.transactionId })
    done(`collect landed (tx ${collected.transactionId}) — paid to ${account.address}`)

    await waitForPosition(
      (position) => position?.tokens_owed0 === 0n && position?.tokens_owed1 === 0n,
      'clear its owed balances',
    )
    progress.owed = false
    recordTag = await waitForFreshRecord(recordTag)

    // ---- 5. burn -------------------------------------------------------------
    step('5/5 burning the emptied position')
    const burned = await client.burn({ positionTokenId: progress.positionTokenId, poolKey })
    transactions.push({ step: 'burn', transactionId: burned.transactionId })
    done(`burn landed (tx ${burned.transactionId})`)

    // The chain is the authority on the burn: the entry is gone from `positions`.
    // The scanner's own view is deliberately not waited on — it marks records spent
    // on its own schedule and can serve a burned position for minutes.
    await waitForPosition((position) => position === null, 'disappear from the positions mapping')
    progress.burned = true

    output(
      {
        network,
        submitted: true,
        poolKey,
        pair,
        positionTokenId: minted.positionTokenId,
        tickLower: preview.tickLower,
        tickUpper: preview.tickUpper,
        deposited0: preview.amount0 + addition.amount0,
        deposited1: preview.amount1 + addition.amount1,
        recovered0: drained!.tokens_owed0,
        recovered1: drained!.tokens_owed1,
        transactions,
      },
      (data) => {
        console.log(`\nRound trip complete on ${data.pair} over ticks ${data.tickLower}…${data.tickUpper}.`)
        console.log(
          `Deposited ${formatAmount(data.deposited0, token0.decimals, token0.symbol)} + ` +
            `${formatAmount(data.deposited1, token1.decimals, token1.symbol)} across two transactions, ` +
            `recovered ${formatAmount(data.recovered0, token0.decimals, token0.symbol)} + ` +
            `${formatAmount(data.recovered1, token1.decimals, token1.symbol)}.`,
        )
        console.log('The difference is what the range gave up to the price it deposited at, plus fees earned.')
        for (const entry of data.transactions) console.log(`  ${entry.step.padEnd(9)} ${entry.transactionId}`)
        console.log('\nThe position is burned; nothing is left open. `shield-swap balances` shows the account.')
      },
    )
  })
}
