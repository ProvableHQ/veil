import { expectTypeOf, test } from 'vitest'
import type { FreezelistProofInput } from '@provablehq/veil-core'
import type { ComplianceProofProvider, ComplianceProofs, ExecuteParameters, ExecuteXReserveBurnParameters, ProvidedProof, UnshieldParameters } from '../../src/index.js'

test('bridge compliance inputs accept one bundle and retain existing wallet requests', () => {
  expectTypeOf<string>().toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<readonly [string]>().toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<readonly ProvidedProof[]>().toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<ComplianceProofProvider>().toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<FreezelistProofInput>().toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<null>().toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<readonly [string, string]>().not.toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<string[]>().not.toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<UnshieldParameters['merkleProof']>().toEqualTypeOf<ComplianceProofs | undefined>()
  expectTypeOf<ExecuteParameters['merkleProof']>().toEqualTypeOf<ComplianceProofs | undefined>()
  expectTypeOf<ExecuteXReserveBurnParameters['merkleProof']>().toEqualTypeOf<ComplianceProofs | undefined>()
})
