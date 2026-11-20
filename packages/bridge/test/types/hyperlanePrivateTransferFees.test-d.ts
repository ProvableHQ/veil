import { expectTypeOf, test } from 'vitest'
import type {
  AleoHyperlanePrivateTransferQuote,
  AleoHyperlaneTransferRemoteCall,
  HyperlanePrivateTransferFees,
} from '../../src/index.js'
import { hyperlane, planHyperlanePrivateTransferFees } from '../../src/index.js'

test('returns the explicit private accounting quote without changing public execution transitions', () => {
  expectTypeOf<Awaited<ReturnType<typeof hyperlane.aleo.quotePrivateTransfer>>>().toEqualTypeOf<AleoHyperlanePrivateTransferQuote>()
  expectTypeOf<AleoHyperlaneTransferRemoteCall['function']>().toEqualTypeOf<'transfer_remote' | 'transfer_remote_as_signer'>()
})

test('preserves bigint amounts and nullable execution fee budgets', () => {
  expectTypeOf<ReturnType<typeof planHyperlanePrivateTransferFees>>().toEqualTypeOf<HyperlanePrivateTransferFees>()
  expectTypeOf<AleoHyperlanePrivateTransferQuote['destinationAmountAtomic']>().toEqualTypeOf<bigint>()
  expectTypeOf<AleoHyperlanePrivateTransferQuote['executionFeeMicrocredits']>().toEqualTypeOf<bigint | null>()
})
