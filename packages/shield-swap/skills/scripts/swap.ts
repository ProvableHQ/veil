/**
 * Swap — sell one token for another, single hop or routed, then claim.
 *
 * A private swap is two transactions: the request, then a claim that turns the
 * output into records the account holds. This does both, because leaving the
 * claim for later is how proceeds get forgotten.
 *
 * `planSwap` picks the route from the API and checks every hop on chain before
 * anything is submitted, so the plan printed below is the plan that executes.
 * The blinded identity is reserved and recorded automatically — nothing to track.
 *
 * SPENDS REAL FUNDS with --execute. Without it, prints the plan and stops.
 *
 * Usage:
 *   npx tsx swap.ts --from USDCx --to ETH --amount 1.5
 *   npx tsx swap.ts --from USDCx --to ETH --amount 1.5 --execute
 *   npx tsx swap.ts --from USDCx --to ALEO --amount 1.5 --slippage 100 --execute
 *   npx tsx swap.ts --network mainnet --from USDCx --to ETH --amount 5 --execute
 *   npx tsx swap.ts --from USDCx --to ETH --amount-raw 1500000 --execute
 *   npx tsx swap.ts --from USDCx --to ETH --amount 1.5 --no-claim --execute
 */
import { SwapOutputNotFinalizedError, parseUnits } from '@provablehq/shield-swap-sdk'
import { loadSession, formatAmount } from './session.js'
import { flags, setJsonMode, step, done, warn, output, confirmed, run } from './cli.js'

const USAGE = `swap.ts — sell one token for another and claim the output

  --from <symbol|id>            token to sell            (required)
  --to <symbol|id>              token to buy             (required)
  --amount <decimal>            human amount, e.g. 1.5   (or --amount-raw)
  --amount-raw <integer>        raw base units
  --slippage <bps>              default 50 (0.5%)
  --no-claim                    submit the swap, leave the output for swap-history.ts
  --network <testnet|mainnet>   default testnet
  --execute                     actually submit
  --json                        machine-readable output`

const args = flags(
  {
    from: { type: 'string' },
    to: { type: 'string' },
    amount: { type: 'string' },
    'amount-raw': { type: 'string' },
    slippage: { type: 'string' },
    'no-claim': { type: 'boolean' },
  },
  USAGE,
)
setJsonMode(!!args.json)

if (!args.from || !args.to) throw new Error(`--from and --to are required.\n\n${USAGE}`)
if (!args.amount && !args['amount-raw']) throw new Error(`--amount or --amount-raw is required.\n\n${USAGE}`)

await run(async () => {
  const { client, network } = await loadSession({ network: args.network as string | undefined })
  done(`session on ${network}`)

  const from = await client.resolveToken(args.from as string)
  const amountIn = args['amount-raw']
    ? BigInt(args['amount-raw'] as string)
    : parseUnits(args.amount as string, from.decimals)

  // Fail before planning if the account cannot cover it: the private side is
  // what funds a swap, and record selection needs ONE record big enough.
  const balances = await client.getBalances({ tokens: [from.id] })
  const held = balances[from.id]?.private ?? 0n
  if (held < amountIn) {
    throw new Error(
      `holding ${formatAmount(held, from.decimals, from.symbol)} privately, ` +
        `which is less than the ${formatAmount(amountIn, from.decimals, from.symbol)} this swap sells. ` +
        'Note a swap spends one record, not the sum of several.',
    )
  }

  step(`planning ${from.symbol} → ${args.to as string}`)
  const plan = await client.planSwap({
    from: from.id,
    to: args.to as string,
    amountIn,
    ...(args.slippage ? { slippageBps: Number(args.slippage) } : {}),
  })
  done(`${plan.multiHop ? `${plan.poolKeys.length}-hop route` : 'direct pool'} found`)

  const planLines = [
    `sell   ${formatAmount(plan.amountIn, plan.from.decimals, plan.from.symbol)}`,
    `buy    ${plan.expectedOut > 0n ? formatAmount(plan.expectedOut, plan.to.decimals, plan.to.symbol) : `${plan.to.symbol} (no quote available)`}`,
    `floor  ${plan.minOut > 0n ? formatAmount(plan.minOut, plan.to.decimals, plan.to.symbol) : 'none — an unquoted swap accepts any fill'}`,
    `route  ${plan.poolKeys.join(' → ')}`,
    `claim  ${args['no-claim'] ? 'no, left for swap-history.ts' : 'yes, in this run'}`,
  ]
  if (!confirmed({ execute: args.execute as boolean | undefined, network, plan: planLines })) {
    output({ network, submitted: false, plan: { ...plan, imports: Object.keys(plan.imports) } }, () => {})
    return
  }

  step('proving and submitting the swap — this takes a minute or two')
  const handle = plan.multiHop
    ? await client.swapMultiHop({
        poolKeys: plan.poolKeys,
        tokenInId: plan.from.id,
        amountIn: plan.amountIn,
        ...(plan.expectedOut > 0n ? { expectedOut: plan.expectedOut } : {}),
        slippageBps: plan.slippageBps,
        imports: plan.imports,
      })
    : await client.swap({
        poolKey: plan.poolKeys[0]!,
        tokenInId: plan.from.id,
        amountIn: plan.amountIn,
        ...(plan.expectedOut > 0n ? { expectedOut: plan.expectedOut } : {}),
        slippageBps: plan.slippageBps,
        imports: plan.imports,
      })
  done(`swap landed: tx ${handle.transactionId}, swapId ${handle.swapId}`)

  let claim: { transactionId: string; amountOut: bigint } | undefined
  if (!args['no-claim']) {
    // The output becomes claimable a few blocks after the swap finalizes, so the
    // first attempts failing is the normal path rather than an error.
    for (let attempt = 0; attempt < 20 && !claim; attempt++) {
      try {
        step(`claiming the output (attempt ${attempt + 1})`)
        claim = await client.claimSwapOutput({ handle, imports: plan.imports })
      } catch (error) {
        if (!(error instanceof SwapOutputNotFinalizedError)) throw error
        await new Promise((resolve) => setTimeout(resolve, 15_000))
      }
    }
    if (claim) done(`claimed ${formatAmount(claim.amountOut, plan.to.decimals, plan.to.symbol)} (tx ${claim.transactionId})`)
    else warn('the output has not finalized yet — claim it later with `npx tsx swap-history.ts --claim --execute`')
  }

  output(
    {
      network,
      submitted: true,
      swapId: handle.swapId,
      transactionId: handle.transactionId,
      sold: plan.amountIn,
      bought: claim?.amountOut ?? null,
      claimTransactionId: claim?.transactionId ?? null,
    },
    (data) => {
      console.log(`\n${data.sold} ${plan.from.symbol} sold.`)
      if (data.bought !== null) console.log(`${data.bought} ${plan.to.symbol} received.`)
      else console.log(`Output not claimed yet — swapId ${data.swapId}`)
    },
  )
})
