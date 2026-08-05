/**
 * Concurrent swaps — several trades in flight at once.
 *
 * Two things contend when swaps run in parallel, and only one is handled for you:
 *
 *   Blinded identities are safe. Each swap reserves its own from the store the
 *   session configures, and reservations serialize, so two swaps cannot derive
 *   the same address and have the second revert on the uniqueness assert.
 *
 *   Records are not. Selection picks ONE private record big enough for the
 *   amount, so two swaps selling the same token can pick the same record and one
 *   fails as a double-spend. This script therefore refuses to run two swaps that
 *   sell the same token, rather than letting the chain reject them.
 *
 * Every swap is planned before any is submitted, so a bad leg is caught while
 * nothing has been spent.
 *
 * SPENDS REAL FUNDS with --execute.
 *
 * Usage:
 *   npx tsx swap-concurrent.ts --swap USDCx:ETH:0.5 --swap ALEO:ETH:1
 *   npx tsx swap-concurrent.ts --swap USDCx:ETH:0.5 --swap ALEO:ETH:1 --execute
 *   npx tsx swap-concurrent.ts --swap USDCx:ETH:0.5 --swap ALEO:ETH:1 --no-claim --execute
 */
import { SwapOutputNotFinalizedError, parseUnits } from '@provablehq/shield-swap-sdk'
import type { SwapPlan } from '@provablehq/shield-swap-sdk'
import { loadSession, formatAmount } from './session.js'
import { flags, setJsonMode, step, done, warn, output, confirmed, run } from './cli.js'

const USAGE = `swap-concurrent.ts — run several swaps at once

  --swap <from:to:amount>       repeatable, e.g. --swap USDCx:ETH:0.5
  --slippage <bps>              default 50 (0.5%)
  --no-claim                    leave the outputs for swap-history.ts
  --network <testnet|mainnet>   default testnet
  --execute                     actually submit
  --json                        machine-readable output

Each --swap must sell a DIFFERENT token: concurrent swaps selling the same token
can select the same record and one will fail as a double-spend.`

const args = flags(
  {
    swap: { type: 'string', multiple: true },
    slippage: { type: 'string' },
    'no-claim': { type: 'boolean' },
  },
  USAGE,
)
setJsonMode(!!args.json)

const specs = (args.swap as string[] | undefined) ?? []
if (specs.length < 2) throw new Error(`pass at least two --swap arguments.\n\n${USAGE}`)

await run(async () => {
  const { client, network } = await loadSession({ network: args.network as string | undefined })
  done(`session on ${network}`)

  // Parse and plan every leg first. A malformed or unroutable leg should surface
  // before anything is submitted, not after half the batch has spent.
  const legs: SwapPlan[] = []
  for (const spec of specs) {
    const [from, to, amount] = spec.split(':')
    if (!from || !to || !amount) {
      throw new Error(`"${spec}" is not from:to:amount, e.g. USDCx:ETH:0.5`)
    }
    const token = await client.resolveToken(from)
    step(`planning ${from} → ${to}`)
    const plan = await client.planSwap({
      from: token.id,
      to,
      amountIn: parseUnits(amount, token.decimals),
      ...(args.slippage ? { slippageBps: Number(args.slippage) } : {}),
    })
    legs.push(plan)
  }

  // The one hazard the store does not cover.
  const sellers = legs.map((leg) => leg.from.id)
  const duplicated = sellers.filter((id, index) => sellers.indexOf(id) !== index)
  if (duplicated.length) {
    const symbol = legs.find((leg) => leg.from.id === duplicated[0])!.from.symbol
    throw new Error(
      `two legs both sell ${symbol}. Record selection picks one record per swap, so these would ` +
        'contend for the same record and one would fail as a double-spend. Sell a different token ' +
        'in each leg, or run them sequentially.',
    )
  }

  // Enough of each token, checked against the private side that funds swaps.
  const balances = await client.getBalances()
  for (const leg of legs) {
    const held = balances[leg.from.id]?.private ?? 0n
    if (held < leg.amountIn) {
      throw new Error(
        `holding ${formatAmount(held, leg.from.decimals, leg.from.symbol)} privately, less than the ` +
          `${formatAmount(leg.amountIn, leg.from.decimals, leg.from.symbol)} one leg sells.`,
      )
    }
  }

  const planLines = legs.map(
    (leg) =>
      `${formatAmount(leg.amountIn, leg.from.decimals, leg.from.symbol)} → ` +
      `${leg.expectedOut > 0n ? formatAmount(leg.expectedOut, leg.to.decimals, leg.to.symbol) : `${leg.to.symbol} (no quote)`}` +
      `${leg.multiHop ? ` via ${leg.poolKeys.length} hops` : ''}`,
  )
  if (
    !confirmed({
      execute: args.execute as boolean | undefined,
      network,
      plan: [...planLines, `${legs.length} swaps submitted together`],
    })
  ) {
    output({ network, submitted: false, legs: legs.length }, () => {})
    return
  }

  step(`submitting ${legs.length} swaps together`)
  // allSettled, not all: one rejection must not abandon the swaps that landed,
  // because their outputs are claimable and would otherwise be forgotten.
  const submitted = await Promise.allSettled(
    legs.map((leg) =>
      leg.multiHop
        ? client.swapMultiHop({
            poolKeys: leg.poolKeys,
            tokenInId: leg.from.id,
            amountIn: leg.amountIn,
            ...(leg.expectedOut > 0n ? { expectedOut: leg.expectedOut } : {}),
            slippageBps: leg.slippageBps,
            imports: leg.imports,
          })
        : client.swap({
            poolKey: leg.poolKeys[0]!,
            tokenInId: leg.from.id,
            amountIn: leg.amountIn,
            ...(leg.expectedOut > 0n ? { expectedOut: leg.expectedOut } : {}),
            slippageBps: leg.slippageBps,
            imports: leg.imports,
          }),
    ),
  )

  const results = submitted.map((result, index) => {
    const leg = legs[index]!
    if (result.status === 'rejected') {
      warn(`${leg.from.symbol} → ${leg.to.symbol} failed: ${(result.reason as Error).message}`)
      return { pair: `${leg.from.symbol}→${leg.to.symbol}`, ok: false as const, error: (result.reason as Error).message }
    }
    done(`${leg.from.symbol} → ${leg.to.symbol} landed: tx ${result.value.transactionId}`)
    return { pair: `${leg.from.symbol}→${leg.to.symbol}`, ok: true as const, handle: result.value, claimed: null as bigint | null }
  })

  if (!args['no-claim']) {
    for (const [index, result] of results.entries()) {
      if (!result.ok) continue
      const leg = legs[index]!
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          step(`claiming ${result.pair} (attempt ${attempt + 1})`)
          const claim = await client.claimSwapOutput({ handle: result.handle, imports: leg.imports })
          result.claimed = claim.amountOut
          done(`claimed ${formatAmount(claim.amountOut, leg.to.decimals, leg.to.symbol)}`)
          break
        } catch (error) {
          if (!(error instanceof SwapOutputNotFinalizedError)) throw error
          await new Promise((resolve) => setTimeout(resolve, 15_000))
        }
      }
    }
  }

  output(
    {
      network,
      submitted: true,
      results: results.map((result) => ({
        pair: result.pair,
        ok: result.ok,
        ...(result.ok
          ? { swapId: result.handle.swapId, transactionId: result.handle.transactionId, claimed: result.claimed }
          : { error: result.error }),
      })),
    },
    (data) => {
      const landed = data.results.filter((result) => result.ok).length
      console.log(`\n${landed}/${data.results.length} swaps landed.`)
      const unclaimed = data.results.filter((result) => 'claimed' in result && result.claimed === null)
      if (unclaimed.length) {
        console.log(`${unclaimed.length} output(s) still unclaimed — \`npx tsx swap-history.ts --claim --execute\`.`)
      }
    },
  )
})
