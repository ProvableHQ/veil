/**
 * A private swap, end to end.
 *
 * A swap on Shield Swap is two transactions, and understanding why explains the
 * shape of everything below. The first submits the request; the contract
 * computes the output and holds it at a single-use blinded address. The second
 * claims that output into records the account owns. Splitting it this way is
 * what keeps the trade unlinkable — nothing on chain ties the payout back to the
 * account that asked for it.
 *
 * The practical consequence: a swap that submits and is never claimed leaves the
 * proceeds sitting on chain. So this does both, and treats the claim as part of
 * the trade rather than a follow-up.
 *
 * SPENDS REAL FUNDS. Needs a funded account holding the input token.
 */
import { parseUnits, formatUnits, SwapOutputNotFinalizedError } from '../../packages/shield-swap/src/index.js'
import { setupClient } from './setup-client.js'

export async function swap() {
  const { client } = await setupClient({ privateKey: process.env.VEIL_E2E_PRIVATE_KEY })

  // Plan first. Everything the two calls below need — the route, the floor, the
  // program sources — comes out of this one read, and none of it is submitted.
  // See quote.ts for what the plan contains.
  const from = await client.tokenData('USDCx')
  const plan = await client.planSwap({ from: from.id, to: 'ETH', amountIn: parseUnits('1.5', from.decimals) })

  // A route through one pool is `swap`; a route that bridges through an
  // intermediate token is `swapMultiHop`. The plan already decided which, so the
  // only thing to do here is call the matching action with it.
  const handle = plan.multiHop
    ? await client.swapMultiHop({
        poolKeys: plan.poolKeys,
        tokenInId: plan.from.id,
        amountIn: plan.amountIn,
        expectedOut: plan.expectedOut,
        slippageBps: plan.slippageBps,
        imports: plan.imports,
      })
    : await client.swap({
        poolKey: plan.poolKeys[0]!,
        tokenInId: plan.from.id,
        amountIn: plan.amountIn,
        expectedOut: plan.expectedOut,
        slippageBps: plan.slippageBps,
        imports: plan.imports,
      })

  // The blinded identity this pays out to was reserved and recorded before the
  // call returned, so the proceeds are locatable even if this process stops
  // here. Nothing needs to be persisted by hand.
  console.log(`submitted ${handle.transactionId}`)

  // The output only becomes claimable once the swap has finalized and the
  // indexer has caught up, which takes a few blocks. Early attempts failing is
  // the expected path, not an error — so this retries on exactly that error and
  // lets anything else through.
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const claim = await client.claimSwapOutput({ handle, imports: plan.imports })
      console.log(`received ${formatUnits(claim.amountOut, plan.to.decimals)} ${plan.to.symbol}`)
      return
    } catch (error) {
      if (!(error instanceof SwapOutputNotFinalizedError)) throw error
      await new Promise((resolve) => setTimeout(resolve, 15_000))
    }
  }

  // Giving up here costs nothing. The identity is recorded, so the proceeds
  // still show up in swap-history.ts and can be claimed whenever.
  console.log('not finalized yet — claim it later')
}
