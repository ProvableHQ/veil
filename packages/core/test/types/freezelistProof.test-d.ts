import { expectTypeOf, it } from 'vitest'
import type { AlgorithmName as UpstreamAlgorithmName, ArgType as UpstreamArgType } from '@provablehq/aleo-types'
import {
  freezelistProofRequest,
  type FreezelistProofInput,
  type FreezelistProofRequest,
  type TransactionInput,
} from '../../src/index.js'
import type { TransferParameters } from '../../src/actions/wallet/transfer.js'

it('accepts typed proofs through Veil using upstream algorithm names and wire tags', () => {
  expectTypeOf<FreezelistProofRequest>().toExtend<TransactionInput>()
  expectTypeOf<FreezelistProofRequest['algorithm']>().toExtend<UpstreamAlgorithmName>()
  // Core intentionally does not import the upstream nominal LiteralType enum.
  expectTypeOf<'string' | 'address'>().toExtend<`${UpstreamArgType}`>()
  expectTypeOf<TransferParameters['merkleProof']>().toEqualTypeOf<FreezelistProofInput | undefined>()
  expectTypeOf(freezelistProofRequest({ freezelistProgram: 'compliance.aleo' })).toEqualTypeOf<FreezelistProofRequest>()
  // @ts-expect-error Freezelist slots cannot accept unrelated algorithms.
  const unrelated: FreezelistProofInput = { type: 'derived', algorithm: 'other', args: {} }
  void unrelated
})
