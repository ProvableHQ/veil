/**
 * Moving a position to a new range in one transaction.
 *
 * A rebalance is close-and-remint made atomic: burn the old position, collect
 * its principal and every fee it earned, optionally add funds, and mint the
 * successor — with the whole thing landing or nothing at all. The owner and
 * withdrawal address carry over, and any surplus returns to the withdrawal
 * address as private records.
 *
 * The part that surprises people: there is no slippage tolerance. The contract
 * re-derives every amount at execution and demands an exact match, so a trade
 * that moves the pool price after the plan is built reverts the whole
 * transaction. That is by design — exactness replaces tolerance. The cost of a
 * revert is the transaction fee, never funds, so the working loop on an active
 * pool is: build late, keep the deadline short, resubmit on revert.
 *
 * SPENDS REAL FUNDS. Needs an existing position — run mint.ts first.
 */
import { formatUnits } from '../../packages/shield-swap/src/index.js'
import { setupClient } from './setup-client.js'

export async function rebalance() {
  const { client } = await setupClient({ privateKey: process.env.VEIL_E2E_PRIVATE_KEY })

  const positions = await client.getOwnedPositions()
  const position = positions[0]
  if (!position) throw new Error('no positions — run mint.ts first')

  const [token0, token1, onchain, slot] = await Promise.all([
    client.tokenData(position.token0Id),
    client.tokenData(position.token1Id),
    client.getPosition({ positionTokenId: position.positionTokenId }),
    client.getSlot({ poolKey: position.poolKey }),
  ])
  if (!onchain || onchain.liquidity === 0n) throw new Error('position holds no liquidity')
  if (!slot) throw new Error('pool slot missing')

  // Recenter the range around the pool's current tick, one spacing wide on
  // each side. A range that no longer straddles the price earns nothing, which
  // is the usual reason to rebalance at all.
  const spacing = Number(slot.tick_spacing)
  const active = Math.floor(slot.tick / spacing) * spacing
  const tickLower = active - spacing
  const tickUpper = active + 2 * spacing

  // Plan first. The budget mode { maxFunding0: 0n, maxFunding1: 0n } means
  // "reuse only what the old position returns": the planner recovers the
  // principal at the current price plus all fees (including those not yet
  // checkpointed on chain), then solves for the largest liquidity the new
  // range supports from that alone. Nothing is spent by planning.
  const plan = await client.planRebalance({
    poolKey: position.poolKey,
    positionTokenId: position.positionTokenId,
    tickLower,
    tickUpper,
    maxFunding0: 0n,
    maxFunding1: 0n,
  })
  console.log(`recovering ${formatUnits(plan.recovered0, token0.decimals)} ${token0.symbol}`)
  console.log(`           ${formatUnits(plan.recovered1, token1.decimals)} ${token1.symbol}`)
  console.log(`refunding  ${formatUnits(plan.refund0, token0.decimals)} ${token0.symbol}`)
  console.log(`           ${formatUnits(plan.refund1, token1.decimals)} ${token1.symbol}`)
  console.log(`new range  [${plan.tickLower}, ${plan.tickUpper}) at liquidity ${plan.liquidityTarget}`)

  // Submit the plan by spreading it into the call. Passing the fields through
  // keeps the submitted numbers exactly the ones printed above; calling
  // rebalancePosition with the sizing instead would replan against whatever
  // the pool looks like at that moment — also fine, just different numbers.
  //
  // No internal swap happens: a new range that wants a different token ratio
  // than the old one returns is funded on one side and refunded on the other.
  // To avoid that, swap toward the target ratio first.
  const imports = await client.resolveDexImports({
    tokenPrograms: [token0.ammTokenProgram!, token1.ammTokenProgram!],
  })
  const result = await client.rebalancePosition({ ...plan, imports })
  console.log(`rebalanced (tx ${result.transactionId})`)
  console.log(`successor position ${result.positionTokenId}`)

  // If this ever throws with an assertion failure instead: the pool moved
  // between the plan and the finalize. Nothing was spent but the fee. Rebuild
  // the plan and resubmit — on a busy pool that is normal, not a bug.
}
