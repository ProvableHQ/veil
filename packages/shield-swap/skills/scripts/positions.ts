/**
 * Position discovery — every liquidity position the account holds, summarized.
 *
 * Discovered from the account's own records, not from a local list: each
 * position is a private NFT, and `getOwnedPositions` joins it with chain state
 * to report the range, the tokens currently backing it, and what `collect`
 * would pay right now.
 *
 * Reads only. Spends nothing.
 *
 * Usage:
 *   npx tsx positions.ts                      # testnet
 *   npx tsx positions.ts --network mainnet
 *   npx tsx positions.ts --pool <poolKey>     # one pool
 *   npx tsx positions.ts --json
 */
import { loadSession, formatAmount } from './session.js'
import { flags, setJsonMode, step, done, warn, output, run } from './cli.js'

const USAGE = `positions.ts — owned liquidity positions and what they are owed

  --network <testnet|mainnet>   default testnet
  --pool <poolKey>              only positions in this pool
  --json                        machine-readable output`

const args = flags({ pool: { type: 'string' } }, USAGE)
setJsonMode(!!args.json)

await run(async () => {
  const { client, network } = await loadSession({ network: args.network as string | undefined })
  done(`session on ${network}`)

  step('scanning position records and joining chain state')
  const owned = await client.getOwnedPositions(args.pool ? { poolKey: args.pool as string } : {})
  const tokens = await client.listTokens()
  const infoOf = (id: string) => tokens.find((token) => token.id === id)

  const rows = owned.map((position) => {
    const t0 = infoOf(position.token0Id)
    const t1 = infoOf(position.token1Id)
    return {
      positionTokenId: position.positionTokenId,
      poolKey: position.poolKey,
      pair: `${t0?.symbol ?? '?'}/${t1?.symbol ?? '?'}`,
      decimals0: t0?.decimals ?? 0,
      decimals1: t1?.decimals ?? 0,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      frozen: position.frozen,
      // A null state means the positions mapping has no entry, which happens at
      // both ends of a position's life: a mint that has not finalized, or one
      // already burned whose record the scanner is still serving. The two are
      // indistinguishable from here, so the label must not claim either.
      noChainEntry: position.state === null,
      liquidity: position.state?.liquidity ?? 0n,
      amount0: position.state?.amount0 ?? 0n,
      amount1: position.state?.amount1 ?? 0n,
      collectable0: position.state?.uncollectedFees0 ?? 0n,
      collectable1: position.state?.uncollectedFees1 ?? 0n,
    }
  })

  output({ network, positions: rows }, (data) => {
    if (!data.positions.length) {
      console.log('\nNo positions. Open one with `npx tsx mint.ts --help`.')
      return
    }
    console.log(`\n${data.positions.length} positions on ${data.network}:\n`)
    for (const row of data.positions) {
      const flagsText = [row.frozen ? 'FROZEN' : '', row.noChainEntry ? 'no chain entry' : '']
        .filter(Boolean)
        .join(', ')
      console.log(`  ${row.pair}  ticks ${row.tickLower}…${row.tickUpper}${flagsText ? `  [${flagsText}]` : ''}`)
      console.log(`    position ${row.positionTokenId}`)
      console.log(`    liquidity ${row.liquidity}`)
      console.log(
        `    backing   ${formatAmount(row.amount0, row.decimals0)} / ${formatAmount(row.amount1, row.decimals1)}`,
      )
      console.log(
        `    collect   ${formatAmount(row.collectable0, row.decimals0)} / ` +
          `${formatAmount(row.collectable1, row.decimals1)}`,
      )
    }
    const owed = data.positions.filter((row) => row.collectable0 > 0n || row.collectable1 > 0n)
    if (owed.length) console.log(`\n${owed.length} position(s) have something to collect — see collect.ts.`)
    if (data.positions.some((row) => row.frozen)) {
      warn('a frozen position blocks every liquidity operation until an admin unfreezes it')
    }
    const ghosts = data.positions.filter((row) => row.noChainEntry).length
    if (ghosts) {
      warn(
        `${ghosts} position(s) have no entry in the positions mapping — either a mint still ` +
          'finalizing or one already burned whose record the scanner has not dropped yet ' +
          '(it can serve a burned record for minutes). Neither can be operated on.',
      )
    }
  })
})
