/**
 * Quoting a swap without submitting one.
 *
 * `quote` resolves token metadata and trusts the API's route and output estimate.
 * It converts decimal amounts precisely and calculates the minimum output.
 * The result can be passed to `client.swap({ quote })` for either 1–3 hops.
 * Quote creation does not read pool state, fetch imports, sign or submit.
 *
 * The route endpoint is bearer-gated, so this needs an authenticated session —
 * but it never submits a transaction.
 */
import { formatUnits } from '../../packages/shield-swap/src/index.js'
import { setupClient } from './setup-client.js'

export async function quote() {
  const { client } = await setupClient({ privateKey: process.env.VEIL_E2E_PRIVATE_KEY })

  const offer = await client.quote({
    from: 'USDCx',
    to: 'ETH',
    // Decimal strings use token units; bigint inputs use raw base units.
    amountIn: '1.5',
    // How far below the quote a fill is still acceptable, in basis points.
    // 50 is 0.5%. Raise it for a thin pool; lower it to refuse a bad fill.
    slippageBps: 50,
  })

  console.log(`sell  ${formatUnits(offer.amountIn, offer.from.decimals)} ${offer.from.symbol}`)
  console.log(`buy   ${formatUnits(offer.expectedOut, offer.to.decimals)} ${offer.to.symbol}`)

  // Missing estimates and zero floors reject. Accepted quotes expire after 60 seconds.
  console.log(`floor ${formatUnits(offer.minOut, offer.to.decimals)}`)
  console.log(`route ${offer.hops.map((hop) => hop.poolKey).join(' → ')}`)
}
