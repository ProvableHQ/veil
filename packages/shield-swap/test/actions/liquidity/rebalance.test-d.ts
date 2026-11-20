import { expectTypeOf, it } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import {
  planRebalanceExactAmounts,
  rebalancePositionExactAmounts,
  type RebalancePlan,
  type RebalancePositionReturnType,
  type ShieldSwapActions,
} from '../../../src/index.js'

declare const client: Client & ShieldSwapActions
declare const plan: RebalancePlan

it('accepts a complete budget plan merged with its original parameters on both action surfaces', () => {
  const params = {
    poolKey: '1field', positionTokenId: '2field', tickLower: -400, tickUpper: 400,
    maxFunding0: 10_000n, maxFunding1: 10_000n,
  }
  expectTypeOf(planRebalanceExactAmounts(client, params)).toEqualTypeOf<Promise<RebalancePlan>>()
  expectTypeOf(rebalancePositionExactAmounts(client, { ...params, ...plan })).toEqualTypeOf<Promise<RebalancePositionReturnType>>()
  expectTypeOf(client.rebalancePositionExactAmounts({ ...params, ...plan })).toEqualTypeOf<Promise<RebalancePositionReturnType>>()
  // @ts-expect-error Planning still requires one sizing mode.
  client.planRebalanceExactAmounts({ ...params, liquidityTarget: 100n })
  // @ts-expect-error Exact execution requires a target, funding budgets, or a complete plan.
  client.rebalancePositionExactAmounts({ poolKey: '1field', tickLower: -400, tickUpper: 400 })
})
