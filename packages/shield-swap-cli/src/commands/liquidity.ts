/**
 * Liquidity — deepen an open position, or take part of it back out.
 *
 * The range is fixed at mint, so neither direction changes it: `--increase`
 * commits more of both tokens over the same bounds, `--decrease` removes
 * liquidity and books the proceeds as owed to the position. Withdrawing does not
 * pay out — `shield-swap collect` is what turns an owed balance into records the account
 * holds.
 *
 * The position is read from chain first. Two states block every liquidity
 * operation and are worth catching before spending a fee: a frozen position (an
 * admin froze it) and one with no entry in the positions mapping (a mint still
 * finalizing, or one already burned whose record the scanner still serves).
 *
 * SPENDS REAL FUNDS with --execute. Without it, prints the plan and stops.
 *
 * Usage:
 *   shield-swap liquidity --position <id> --increase --percent 1
 *   shield-swap liquidity --position <id> --increase --percent 1 --execute
 *   shield-swap liquidity --position <id> --increase --amount0 0.5 --execute
 *   shield-swap liquidity --position <id> --decrease --percent 50 --execute
 *   shield-swap liquidity --position <id> --decrease --amount1 0.25 --execute
 */
import type { TokenInfo } from '@provablehq/shield-swap-sdk'
import {
  amountsForLiquidity,
  getSqrtPriceAtTickX128,
  liquidityForAmounts,
  liquidityForAmount,
} from '@provablehq/shield-swap-sdk'
import { loadSession, formatAmount, namedAmounts, pollUntil } from '../session.js'
import { flags, step, done, warn, output, confirmed, run, fail } from '../shared.js'

const USAGE = `shield-swap liquidity — add to or withdraw from an open position

  --position <id>               position token id            (required)
  --increase                    commit more of both tokens
  --decrease                    remove liquidity, booking it as owed
  --amount <symbol>:<decimal>   how much of one named token, e.g. USDCx:0.5.
                                Repeatable, once per side. Prefer this — it does
                                not depend on knowing the pool's token order
  --amount0 <decimal>           token0 to add, or to withdraw, in human units
  --amount1 <decimal>           token1 to add, or to withdraw
  --percent <n>                 --increase: n% of the private balance of both
                                sides; --decrease: n% of the position's liquidity
  --network <testnet|mainnet>   default testnet
  --execute                     actually submit
  --json                        machine-readable output

List positions with \`shield-swap positions\`. A decrease books what it removes as
owed to the position — run \`shield-swap collect\` to take it out.

--amount0/--amount1 follow the pool's own token order; the line this script
prints for the position names both symbols.`

/**
 * Runs the `liquidity` subcommand.
 *
 * @param argv Arguments after the subcommand name, as the dispatcher supplies them.
 */
export async function main(argv: string[]): Promise<void> {
  const args = flags(
    {
      position: { type: 'string' },
      increase: { type: 'boolean' },
      decrease: { type: 'boolean' },
      amount: { type: 'string', multiple: true },
      amount0: { type: 'string' },
      amount1: { type: 'string' },
      percent: { type: 'string' },
    },
    USAGE,
    argv,
  )

  const bySymbol = (args.amount as string[] | undefined) ?? []
  const anyAmount = bySymbol.length > 0 || !!args.amount0 || !!args.amount1

  if (!args.position) fail(`--position is required.\n\n${USAGE}`)
  if (!!args.increase === !!args.decrease) fail(`pass exactly one of --increase or --decrease.\n\n${USAGE}`)
  if (!args.percent && !anyAmount) {
    fail(`--percent, --amount, --amount0, or --amount1 is required.\n\n${USAGE}`)
  }
  if (args.percent && anyAmount) {
    fail(`--percent and the amount flags are alternatives, not both.\n\n${USAGE}`)
  }

  const positionTokenId = args.position as string
  const percent = args.percent ? Number(args.percent) : undefined
  if (percent !== undefined && (!(percent > 0) || percent > 100)) {
    fail(`--percent must be greater than 0 and at most 100, got ${args.percent as string}`)
  }

  /** Basis points of a whole, so `--percent 12.5` is exact rather than rounded to 12. */
  const share = (total: bigint, pct: number) => (total * BigInt(Math.round(pct * 100))) / 10_000n

  /** This script's amount flags, placed into one pool's token order. */
  const amountsFor = (token0: TokenInfo, token1: TokenInfo) =>
    namedAmounts({
      entries: bySymbol,
      indexed: [args.amount0 as string | undefined, args.amount1 as string | undefined],
      tokens: [token0, token1],
    })

  await run(async () => {
    const { client, network } = await loadSession({ network: args.network as string | undefined })
    done(`session on ${network}`)

    step('reading the position from chain')
    const position = await client.getOwnedPosition({ positionTokenId })
    if (!position) {
      throw new Error(
        `this account holds no position record for ${positionTokenId} on ${network}. ` +
          'List what it does hold with `shield-swap positions`.',
      )
    }
    if (position.frozen) {
      throw new Error(
        `position ${positionTokenId} is frozen: every liquidity operation on it reverts until an admin unfreezes it.`,
      )
    }
    // Pulled out of the position so the checked value is what the rest of the
    // script reads, rather than a property that has to be re-checked.
    const state = position.state
    if (!state) {
      throw new Error(
        `position ${positionTokenId} has no entry in the positions mapping. Either its mint has not ` +
          'finalized yet — wait a few seconds and retry — or it was already burned and the record scanner ' +
          'is still serving the spent record, which it can do for minutes. Neither can be operated on.',
      )
    }

    const tokens = await client.listTokens()
    const infoOf = (id: string) => tokens.find((token) => token.id === id)
    const token0 = infoOf(position.token0Id)
    const token1 = infoOf(position.token1Id)
    if (!token0 || !token1) throw new Error(`the registry does not describe both tokens of pool ${position.poolKey}.`)
    const pair = `${token0.symbol}/${token1.symbol}`
    done(`${pair} position over ticks ${position.tickLower}…${position.tickUpper}, liquidity ${state.liquidity}`)

    /**
     * Polls the positions mapping until the liquidity satisfies `predicate`.
     *
     * Mapping writes propagate to reads asynchronously, so the first read after a
     * confirmed transaction can still show the previous value.
     *
     * @param predicate What the settled liquidity must satisfy.
     * @param verb Completes "liquidity did not … within 30s" in the warning.
     * @returns The settled liquidity, or `undefined` when the read never caught up.
     */
    const waitForLiquidity = async (predicate: (liquidity: bigint) => boolean, verb: string) => {
      let settled: bigint | undefined
      const caught = await pollUntil(
        async () => {
          const onchain = await client.getPosition({ positionTokenId })
          if (onchain && predicate(onchain.liquidity)) settled = onchain.liquidity
          return settled !== undefined
        },
        10,
        3_000,
      )
      if (!caught) {
        warn(
          `the position's liquidity did not ${verb} within 30s of the transaction landing — the mapping ` +
            'may still be catching up; check `shield-swap positions`',
        )
      }
      return settled
    }

    if (args.increase) {
      // Private records fund a deposit; the public balance cannot be added.
      const balances = await client.getBalances({ tokens: [token0.id, token1.id] })
      const held0 = balances[token0.id]?.private ?? 0n
      const held1 = balances[token1.id]?.private ?? 0n
      const { amount0: named0, amount1: named1 } = amountsFor(token0, token1)

      // Naming exactly one side makes it authoritative: the other is derived as the
      // minimum that must come with it. Offering the unnamed side's whole balance as
      // a ceiling instead would let a short balance quietly govern, adding a
      // fraction of the liquidity that was asked for without saying so.
      let budget0 = percent ? share(held0, percent) : (named0 ?? held0)
      let budget1 = percent ? share(held1, percent) : (named1 ?? held1)
      if (!percent && (named0 === undefined) !== (named1 === undefined)) {
        const side = named0 === undefined ? 1 : 0
        const named = named0 ?? named1!
        const slot = await client.getSlot({ poolKey: position.poolKey })
        if (!slot) throw new Error(`pool ${position.poolKey} has no slot on chain`)
        const range = {
          sqrtPriceX128: slot.sqrt_price,
          sqrtLowerX128: getSqrtPriceAtTickX128(position.tickLower),
          sqrtUpperX128: getSqrtPriceAtTickX128(position.tickUpper),
        }
        const liquidity = liquidityForAmount({ ...range, side, amount: named })
        if (liquidity === 0n) {
          // Either the amount is dust over this width, or the price has left the
          // side that was named — a distinction worth making, since one is fixed by
          // depositing more and the other by naming the other token.
          const other = side === 0 ? token1 : token0
          const unused = side === 0 ? slot.tick >= position.tickUpper : slot.tick < position.tickLower
          throw new Error(
            unused
              ? `at tick ${slot.tick} this position holds only ${other.symbol}, so ` +
                `${side === 0 ? token0.symbol : token1.symbol} cannot fund it — name --amount${other === token1 ? '1' : '0'} instead.`
              : `${formatAmount(named, side === 0 ? token0.decimals : token1.decimals, side === 0 ? token0.symbol : token1.symbol)} ` +
                `adds no liquidity over ticks ${position.tickLower}…${position.tickUpper} — commit more.`,
          )
        }
        // Deposit-side rounding, so neither derived amount rounds below what the
        // finalize will require.
        const required = amountsForLiquidity({ ...range, liquidity, roundUp: true })
        budget0 = required.amount0
        budget1 = required.amount1
        const derived = side === 0 ? token1 : token0
        const amount = side === 0 ? required.amount1 : required.amount0
        done(`${derived.symbol} derived: ${formatAmount(amount, derived.decimals, derived.symbol)} needed alongside`)
      }

      // Priced over the position's own bounds, which are already spacing-aligned,
      // so the preview reports purely what the deposit buys and what it consumes.
      step('pricing the addition against the pool’s live price')
      const preview = await client.previewMint({
        poolKey: position.poolKey,
        amount0Desired: budget0,
        amount1Desired: budget1,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
      })
      if (preview.liquidity === 0n) {
        throw new Error(
          `that budget adds no liquidity over ticks ${position.tickLower}…${position.tickUpper} — commit ` +
            'more. An increase would cost a fee and add nothing.',
        )
      }
      for (const side of [
        { info: token0, needed: preview.amount0, held: held0 },
        { info: token1, needed: preview.amount1, held: held1 },
      ]) {
        // One record funds each side, not the sum of several, so a balance large
        // enough in total can still be too fragmented to spend.
        if (side.needed > side.held) {
          throw new Error(
            `the addition needs ${formatAmount(side.needed, side.info.decimals, side.info.symbol)} but only ` +
              `${formatAmount(side.held, side.info.decimals, side.info.symbol)} is held privately.`,
          )
        }
      }

      const planLines: Array<readonly [string, string]> = [
        ['position', positionTokenId],
        ['pool', `${pair}  ticks ${position.tickLower}…${position.tickUpper}`],
        ['add', formatAmount(preview.amount0, token0.decimals, token0.symbol)],
        // Empty label: the second side of the same deposit, not a separate step.
        ['', formatAmount(preview.amount1, token1.decimals, token1.symbol)],
        ['liquidity', `${state.liquidity} → about ${state.liquidity + preview.liquidity}`],
      ]
      if (!confirmed({ execute: args.execute as boolean | undefined, network, plan: planLines })) {
        output({ network, submitted: false, action: 'increase', positionTokenId, preview }, () => {})
        return
      }

      // Both token programs' sources: the prover cannot discover the dynamically
      // dispatched IARC20 callees on its own.
      const imports = await client.resolveDexImports({
        tokenPrograms: [token0.ammTokenProgram, token1.ammTokenProgram].filter(
          (program): program is string => !!program,
        ),
      })
      step('proving and submitting the increase — this takes a minute or two')
      const result = await client.increaseLiquidity({
        positionTokenId,
        poolKey: position.poolKey,
        amount0Desired: preview.amount0,
        amount1Desired: preview.amount1,
        imports,
      })
      done(`increase landed: tx ${result.transactionId}`)

      const settled = await waitForLiquidity((liquidity) => liquidity > state.liquidity, 'grow')
      output(
        {
          network,
          submitted: true,
          action: 'increase',
          positionTokenId,
          transactionId: result.transactionId,
          added0: preview.amount0,
          added1: preview.amount1,
          liquidityBefore: state.liquidity,
          liquidityAfter: settled ?? null,
        },
        (data) => {
          console.log(
            `\nAdded ${formatAmount(data.added0, token0.decimals, token0.symbol)} and ` +
              `${formatAmount(data.added1, token1.decimals, token1.symbol)} to position ${data.positionTokenId}.`,
          )
          console.log(`Liquidity ${data.liquidityBefore} → ${data.liquidityAfter ?? 'still settling'}.`)
        },
      )
      return
    }

    // --decrease from here down.
    if (state.liquidity === 0n) {
      throw new Error(
        `position ${positionTokenId} holds no liquidity to remove. Collect what it is owed with ` +
          '`shield-swap collect --position <id> --close`.',
      )
    }
    const slot = await client.getSlot({ poolKey: position.poolKey })
    if (!slot) throw new Error(`pool ${position.poolKey} has no slot state, so it cannot be operated on.`)
    const sqrtLower = getSqrtPriceAtTickX128(position.tickLower)
    const sqrtUpper = getSqrtPriceAtTickX128(position.tickUpper)

    let liquidityToRemove: bigint
    if (percent) {
      // 100% removes exactly what the position holds rather than a rounded share:
      // a base unit left behind blocks the burn.
      liquidityToRemove = percent === 100 ? state.liquidity : share(state.liquidity, percent)
    } else {
      // The contract takes liquidity, not amounts, so a named amount is converted
      // through the same math a deposit uses. An unnamed side offers everything the
      // position backs — a zero there would floor the conversion to nothing.
      const named = amountsFor(token0, token1)
      const want0 = named.amount0 ?? null
      const want1 = named.amount1 ?? null
      for (const side of [
        { want: want0, backing: state.amount0, info: token0 },
        { want: want1, backing: state.amount1, info: token1 },
      ]) {
        // Asking for more than the range holds is a misunderstanding rather than a
        // rounding matter, and the cap below would quietly turn it into "all of it".
        if (side.want !== null && side.want > side.backing) {
          throw new Error(
            `asked to withdraw ${formatAmount(side.want, side.info.decimals, side.info.symbol)} but the ` +
              `position backs ${formatAmount(side.backing, side.info.decimals, side.info.symbol)} at the ` +
              "pool's current price.",
          )
        }
      }
      const requested = liquidityForAmounts({
        sqrtPriceX128: slot.sqrt_price,
        sqrtLowerX128: sqrtLower,
        sqrtUpperX128: sqrtUpper,
        amount0: want0 ?? state.amount0,
        amount1: want1 ?? state.amount1,
      })
      // Capped rather than rejected: the conversion can ask for a unit more than
      // the position holds, and removing all of it is the intent either way.
      liquidityToRemove = requested > state.liquidity ? state.liquidity : requested
    }
    if (liquidityToRemove === 0n) {
      throw new Error(
        'that amount converts to zero liquidity for this range — ask for more, or use --percent to remove ' +
          'a share of the position instead.',
      )
    }

    // Withdrawal-side rounding (`false`): what the contract books as owed, not what
    // a deposit of the same size would cost.
    const booked = amountsForLiquidity({
      sqrtPriceX128: slot.sqrt_price,
      sqrtLowerX128: sqrtLower,
      sqrtUpperX128: sqrtUpper,
      liquidity: liquidityToRemove,
      roundUp: false,
    })

    const planLines: Array<readonly [string, string]> = [
      ['position', positionTokenId],
      ['pool', `${pair}  ticks ${position.tickLower}…${position.tickUpper}`],
      ['remove', `${liquidityToRemove} of ${state.liquidity} liquidity`],
      ['books', `about ${formatAmount(booked.amount0, token0.decimals, token0.symbol)}`],
      // Empty label: the second side of the same booking.
      ['', `about ${formatAmount(booked.amount1, token1.decimals, token1.symbol)}`],
      ['payout', 'none — this books the amounts as owed; `shield-swap collect` pays them out'],
    ]
    if (!confirmed({ execute: args.execute as boolean | undefined, network, plan: planLines })) {
      output(
        {
          network,
          submitted: false,
          action: 'decrease',
          positionTokenId,
          liquidityToRemove,
          booked0: booked.amount0,
          booked1: booked.amount1,
        },
        () => {},
      )
      return
    }

    // No imports: a decrease moves no tokens, so there is no dynamically dispatched
    // IARC20 call for the prover to resolve.
    step('proving and submitting the decrease — this takes a minute or two')
    const result = await client.decreaseLiquidity({
      positionTokenId,
      poolKey: position.poolKey,
      liquidityToRemove,
    })
    done(`decrease landed: tx ${result.transactionId}`)

    const settled = await waitForLiquidity((liquidity) => liquidity < state.liquidity, 'shrink')
    const owed = await client.getPosition({ positionTokenId })
    output(
      {
        network,
        submitted: true,
        action: 'decrease',
        positionTokenId,
        transactionId: result.transactionId,
        liquidityRemoved: liquidityToRemove,
        liquidityBefore: state.liquidity,
        liquidityAfter: settled ?? null,
        owed0: owed?.tokens_owed0 ?? null,
        owed1: owed?.tokens_owed1 ?? null,
      },
      (data) => {
        console.log(`\nRemoved ${data.liquidityRemoved} liquidity from position ${data.positionTokenId}.`)
        console.log(`Liquidity ${data.liquidityBefore} → ${data.liquidityAfter ?? 'still settling'}.`)
        if (data.owed0 !== null && data.owed1 !== null) {
          console.log(
            `Owed to the position: ${formatAmount(data.owed0, token0.decimals, token0.symbol)} and ` +
              `${formatAmount(data.owed1, token1.decimals, token1.symbol)}.`,
          )
        }
        console.log('Take it out with `shield-swap collect --position <id>`.')
      },
    )
  })
}
