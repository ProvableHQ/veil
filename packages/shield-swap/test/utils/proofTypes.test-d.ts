import { expectTypeOf, test } from 'vitest'
import type { ClaimSwapOutputParameters, CollectParameters, IncreaseLiquidityParameters, MintParameters, RebalancePositionParameters, SwapParameters } from '../../src/index.js'

test('literal arity follows each action; strings are accepted for single-proof routes', () => {
  expectTypeOf<string>().toMatchTypeOf<SwapParameters['proofs']>()
  expectTypeOf<string>().toMatchTypeOf<ClaimSwapOutputParameters['proofs']>()
  expectTypeOf<readonly [string, string, string]>().toMatchTypeOf<MintParameters['proofs']>()
  expectTypeOf<readonly [string, string, string, string, string]>().toMatchTypeOf<MintParameters['proofs']>()
  expectTypeOf<readonly [string, string]>().toMatchTypeOf<CollectParameters['proofs']>()
  expectTypeOf<readonly [string, string]>().toMatchTypeOf<IncreaseLiquidityParameters['proofs']>()
  expectTypeOf<readonly [string, string, string, string, string, string]>().toMatchTypeOf<RebalancePositionParameters['proofs']>()
  expectTypeOf<string[]>().not.toMatchTypeOf<MintParameters['proofs']>()
  expectTypeOf<readonly [string, string]>().not.toMatchTypeOf<MintParameters['proofs']>()
  expectTypeOf<string>().not.toMatchTypeOf<CollectParameters['proofs']>()
  expectTypeOf<readonly [string, string]>().not.toMatchTypeOf<SwapParameters['proofs']>()
})
