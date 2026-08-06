/**
 * Quoting a swap without submitting one.
 *
 * `planSwap` does everything a swap needs except sign. It resolves both tokens
 * from whatever they were named, asks the API for a route, checks on chain that
 * every hop is tradeable and has liquidity, gathers the program sources the
 * transaction will need, and turns the quote into a slippage floor.
 *
 * That makes it the safe first move on any trade: the plan it returns is exactly
 * what would execute, and producing it spends nothing. Reading a plan before
 * submitting is the difference between a trade that was chosen and one that was
 * hoped for.
 *
 * The route endpoint is bearer-gated, so this needs an authenticated session —
 * but it never submits a transaction.
 */
import { parseUnits, formatUnits } from '../../packages/shield-swap/src/index.js'
import { setupClient } from './setup-client.js'

export async function quote() {
  const { client } = await setupClient({ privateKey: process.env.VEIL_E2E_PRIVATE_KEY })

  // Tokens can be named by symbol or by id. Resolving first gives the decimals,
  // which are needed to turn a human amount into what the AMM accounts in.
  const from = await client.tokenData('USDCx')

  const plan = await client.planSwap({
    from: from.id,
    to: 'ETH',
    // Every amount in the SDK is raw base units. `parseUnits` applies the
    // token's decimals, so "1.5" USDCx at 6 decimals becomes 1_500_000n.
    // Passing 1.5 directly would sell a millionth of what was meant.
    amountIn: parseUnits('1.5', from.decimals),
    // How far below the quote a fill is still acceptable, in basis points.
    // 50 is 0.5%. Raise it for a thin pool; lower it to refuse a bad fill.
    slippageBps: 50,
  })

  console.log(`sell  ${formatUnits(plan.amountIn, plan.from.decimals)} ${plan.from.symbol}`)
  console.log(`buy   ${formatUnits(plan.expectedOut, plan.to.decimals)} ${plan.to.symbol}`)

  // A quote is informational, and the API does not always have one. When it does
  // not, `minOut` is zero — which means the swap carries no floor and would
  // accept any fill at all. That is a decision to make deliberately, so the plan
  // reports the absence rather than substituting a floor of its own.
  //
  // Passing no `expectedOut` to `swap()` at all is the other option: the action
  // then derives a floor from the pool's live sqrt price. That one is chain-read
  // rather than quoted, but it ignores price impact and fees, so it sits above
  // what a large trade can actually fill.
  console.log(`floor ${plan.minOut > 0n ? formatUnits(plan.minOut, plan.to.decimals) : 'none — unquoted'}`)

  // One pool key is a direct swap; several means the route bridges through an
  // intermediate token, and `plan.multiHop` says which action to call.
  console.log(`route ${plan.poolKeys.join(' → ')}`)
}
