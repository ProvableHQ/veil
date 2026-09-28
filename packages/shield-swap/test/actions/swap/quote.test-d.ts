import { expectTypeOf, it } from 'vitest'
import type { Client } from '@provablehq/veil-core'
import { swap, type SwapHandle } from '../../../src/actions/swap/swap.js'
import type { MultiHopSwapHandle } from '../../../src/actions/swap/swapMultiHop.js'
import type { SwapQuote } from '../../../src/actions/swap/quote.js'
import type { ShieldSwapActions } from '../../../src/decorators/shieldSwapActions.js'

declare const client: Client & ShieldSwapActions
declare const quote: SwapQuote

it('retains manual return types and accepts quotes on both action surfaces', () => {
  expectTypeOf(client.swap({ poolKey: '1field', tokenInId: '2field', amountIn: 1n })).toEqualTypeOf<Promise<SwapHandle>>()
  expectTypeOf(swap(client, { poolKey: '1field', tokenInId: '2field', amountIn: 1n })).toEqualTypeOf<Promise<SwapHandle>>()
  expectTypeOf(client.swap({ quote })).toEqualTypeOf<Promise<SwapHandle | MultiHopSwapHandle>>()
  expectTypeOf(swap(client, { quote })).toEqualTypeOf<Promise<SwapHandle | MultiHopSwapHandle>>()
  // @ts-expect-error Quote fixes the input amount.
  client.swap({ quote, amountIn: 2n })
  // @ts-expect-error Quote fixes slippage.
  swap(client, { quote, slippageBps: 100 })
  // @ts-expect-error Quote fixes the program.
  client.swap({ quote, program: 'other.aleo' })
  expectTypeOf(client.quote({ from: 'A', to: 'B', amountIn: '1.5' })).toEqualTypeOf<Promise<SwapQuote>>()
  // @ts-expect-error Floating-point numbers are ambiguous; use strings or bigint.
  client.quote({ from: 'A', to: 'B', amountIn: 1.5 })
})
