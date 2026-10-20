import { expectTypeOf, test } from 'vitest'
import type { ClaimSwapOutputParameters, CollectParameters, IncreaseLiquidityParameters, MintParameters, ProofInputProvider, ProofProvider, RebalancePositionParameters, ShieldSwapActionsConfig, SwapMultiHopParameters, SwapParameters } from '../../src/index.js'

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

test('existing pair providers remain assignable to every action and client default', () => {
  expectTypeOf<ProofProvider>().toMatchTypeOf<ProofInputProvider>()
  expectTypeOf<ProofProvider>().toMatchTypeOf<SwapParameters['proofs']>()
  expectTypeOf<ProofProvider>().toMatchTypeOf<SwapMultiHopParameters['proofs']>()
  expectTypeOf<ProofProvider>().toMatchTypeOf<ClaimSwapOutputParameters['proofs']>()
  expectTypeOf<ProofProvider>().toMatchTypeOf<MintParameters['proofs']>()
  expectTypeOf<ProofProvider>().toMatchTypeOf<IncreaseLiquidityParameters['proofs']>()
  expectTypeOf<ProofProvider>().toMatchTypeOf<CollectParameters['proofs']>()
  expectTypeOf<ProofProvider>().toMatchTypeOf<RebalancePositionParameters['proofs']>()
  expectTypeOf<ProofProvider>().toMatchTypeOf<ShieldSwapActionsConfig['proofs']>()
})
