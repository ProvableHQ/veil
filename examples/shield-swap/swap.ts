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

  // Quote first; swap dispatches to the appropriate 1–3-hop action automatically.
  const from = await client.tokenData('USDCx')
  const offer = await client.quote({ from: from.id, to: 'ETH', amountIn: parseUnits('1.5', from.decimals) })

  // Resolve sources once so both the swap and its later claim can reuse them.
  // Without an explicit map, swap({ quote }) resolves these during preparation.
  const tokenIds = new Set(offer.hops.flatMap((hop) => [hop.tokenInId, hop.tokenOutId]))
  const tokens = await Promise.all([...tokenIds].map((id) => client.tokenData(id)))
  const imports = await client.resolveDexImports({
    tokenPrograms: tokens.flatMap((token) => token.ammTokenProgram ? [token.ammTokenProgram] : []),
    program: offer.program,
  })
  const handle = await client.swap({ quote: offer, imports })

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
      const claim = await client.claimSwapOutput({ handle, imports })
      console.log(`received ${formatUnits(claim.amountOut, offer.to.decimals)} ${offer.to.symbol}`)
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
