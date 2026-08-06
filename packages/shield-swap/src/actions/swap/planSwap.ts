import type { Client } from '@provablehq/veil-core'
import type { ApiClient } from '../../api/client.js'
import { getSlot } from '../reads/getSlot.js'
import { getTradeControls } from '../reads/getTradeControls.js'
import { resolveDexImports } from '../../utils/imports.js'
import { tokenData, type TokenInfo } from '../../utils/tokens.js'
import { parseUnits, formatUnits } from '../../utils/units.js'

/**
 * An executable swap: which pools, how much out, and the floor to submit with.
 *
 * @property from Token being sold, resolved from whatever the caller named.
 * @property to Token being bought.
 * @property amountIn Raw base units to sell.
 * @property poolKeys Pool keys in route order. One entry is a single-hop swap
 *   for `swap`; two or more is a route for `swapMultiHop`.
 * @property multiHop Whether `swapMultiHop` is the action to call.
 * @property expectedOut The route's quote in raw base units, converted from the
 *   decimal string the API reports, or `0n` when it returned none — a quote is
 *   informational and its absence is not fatal.
 * @property minOut `expectedOut` less slippage, the floor the contract enforces.
 *   Zero when there was no quote, which means the swap carries no floor.
 * @property slippageBps Basis points allowed below the quote.
 * @property imports Program sources every hop needs, ready for the action.
 */
export type SwapPlan = {
  from: TokenInfo
  to: TokenInfo
  amountIn: bigint
  poolKeys: string[]
  multiHop: boolean
  expectedOut: bigint
  minOut: bigint
  slippageBps: number
  imports: Record<string, string>
}

/**
 * Parameters for {@link planSwap}.
 *
 * @property from Token to sell, as a symbol or an id.
 * @property to Token to buy, as a symbol or an id.
 * @property amountIn Raw base units to sell. Apply the token's decimals before
 *   calling — the AMM accounts in base units and so does this.
 * @property slippageBps Basis points below the quote to accept. Defaults to 50
 *   (0.5%). Raise it for a thin pool, lower it to refuse a bad fill.
 * @property program shield_swap program override.
 */
export type PlanSwapParameters = {
  from: string
  to: string
  amountIn: bigint
  slippageBps?: number
  program?: string
}

type RouteHop = { pool_key: string; token_in: string; token_out: string }

/**
 * Turns "sell this for that" into something an action can execute.
 *
 * The route comes from the API, which knows the pool graph and quotes the fill;
 * the tradeability check comes from chain, because the index can list a pool the
 * contract refuses to trade and a swap into one reverts. Both matter: without the
 * route a caller has to pick pools by hand, and without the chain check a plan
 * can look fine and fail on finalize.
 *
 * `imports` is assembled for every token the route touches, which is what a
 * write needs and what callers most often get wrong on multi-hop.
 *
 * Hits the network: token registry, route, and one slot plus control read per
 * hop. Reads only — nothing is submitted.
 *
 * @param client A Veil client whose transport can reach an Aleo node.
 * @param api The DEX API client, usually `client.api`.
 * @param params What to sell, what to buy, and how much.
 * @returns A plan, ready to pass to `swap` or `swapMultiHop`.
 * @throws When either token is unknown on this network, when no route exists, or
 *   when a hop is not tradeable — each naming the hop that failed rather than
 *   the route as a whole.
 *
 * @example
 * const plan = await planSwap(client, client.api, { from: 'USDCx', to: 'ETH', amountIn: 5_000_000n })
 * const handle = plan.multiHop
 *   ? await client.swapMultiHop({ poolKeys: plan.poolKeys, tokenInId: plan.from.id, amountIn: plan.amountIn, expectedOut: plan.expectedOut, imports: plan.imports })
 *   : await client.swap({ poolKey: plan.poolKeys[0]!, tokenInId: plan.from.id, amountIn: plan.amountIn, expectedOut: plan.expectedOut, imports: plan.imports })
 */
export async function planSwap(
  client: Client,
  api: ApiClient,
  params: PlanSwapParameters,
): Promise<SwapPlan> {
  // First, before any network call: the floor arithmetic below fails three ways on
  // a bad value — `BigInt` throws a RangeError on `NaN` or a fraction, above 10000
  // the multiplier goes negative, and below 0 the floor rises ABOVE the quote so
  // every swap reverts for demanding more than the pool offers. All three are
  // reachable from `Number(someFlag)`, and none is worth a token lookup and a
  // route fetch to discover.
  const slippageBps = params.slippageBps ?? 50
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new Error(
      `slippageBps must be a whole number of basis points between 0 and 10000, got ${slippageBps}. ` +
        '50 is 0.5%; 10000 accepts any fill.',
    )
  }
  const [from, to] = await Promise.all([
    tokenData(api, params.from),
    tokenData(api, params.to),
  ])
  if (from.id === to.id) throw new Error(`cannot swap ${from.symbol} for itself`)

  // The route endpoint speaks decimals in both directions, unlike everything
  // else here. Sending base units quotes a trade orders of magnitude larger and
  // yields a slippage floor no real swap can meet.
  const route = (
    await api.getRoute({
      token_in: from.id,
      token_out: to.id,
      amount_in: formatUnits(params.amountIn, from.decimals),
    })
  ).data
  const hops = (route.hops ?? []) as RouteHop[]
  if (!hops.length) {
    throw new Error(
      `no route from ${from.symbol} to ${to.symbol} on this network — no pool connects them, ` +
        'directly or through a bridging token.',
    )
  }

  // Every hop, not just the first: a route is only as tradeable as its worst
  // pool, and the contract checks each one at finalize.
  for (const hop of hops) {
    const [slot, controls] = await Promise.all([
      getSlot(client, { poolKey: hop.pool_key, ...(params.program ? { program: params.program } : {}) }),
      getTradeControls(client, {
        poolKey: hop.pool_key,
        ...(params.program ? { program: params.program } : {}),
      }),
    ])
    if (!slot) throw new Error(`pool ${hop.pool_key} is in the route but not on chain`)
    if (!controls.tradeable) {
      throw new Error(`pool ${hop.pool_key} is paused or gated on chain, so this route cannot execute`)
    }
    if (slot.liquidity === 0n) {
      throw new Error(`pool ${hop.pool_key} has no liquidity, so this route would revert`)
    }
  }

  // Token programs for every hop, deduplicated by resolveDexImports.
  const touched = new Set<string>([from.id, to.id, ...hops.flatMap((hop) => [hop.token_in, hop.token_out])])
  const programs: string[] = []
  for (const tokenId of touched) {
    const token = await tokenData(api, tokenId)
    if (token.ammTokenProgram) programs.push(token.ammTokenProgram)
  }
  const imports = await resolveDexImports(client, {
    tokenPrograms: programs,
    ...(params.program ? { program: params.program } : {}),
  })

  // The API quotes in decimal units of the output token, not base units — a
  // BigInt of "1.0304…" throws, and rounding it through a double would move the
  // slippage floor. Convert on the string with the token's own decimals.
  const expectedOut = route.estimated_amount_out
    ? parseUnits(route.estimated_amount_out, to.decimals)
    : 0n
  return {
    from,
    to,
    amountIn: params.amountIn,
    poolKeys: hops.map((hop) => hop.pool_key),
    multiHop: hops.length > 1,
    expectedOut,
    // No quote means no floor: submitting `0` would accept any fill, so the
    // caller is told the quote is missing rather than handed a false guarantee.
    minOut: expectedOut > 0n ? (expectedOut * BigInt(10_000 - slippageBps)) / 10_000n : 0n,
    slippageBps,
    imports,
  }
}
