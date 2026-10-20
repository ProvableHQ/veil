import { expectTypeOf, test } from 'vitest'
import type { Client, FreezelistProofInput, WalletClient } from '@provablehq/veil-core'
import type { AleoWalletClient, ComplianceProofProvider, ComplianceProofs, ExecuteParameters, ExecuteXReserveBurnParameters, SuppliedComplianceProof, UnshieldParameters } from '../../src/index.js'

test('bridge compliance inputs accept one bundle and retain existing wallet requests', () => {
  expectTypeOf<string>().toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<readonly [string]>().toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<readonly SuppliedComplianceProof[]>().toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<ComplianceProofProvider>().toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<FreezelistProofInput>().toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<null>().toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<readonly [string, string]>().not.toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<string[]>().not.toMatchTypeOf<ComplianceProofs>()
  expectTypeOf<UnshieldParameters['merkleProof']>().toEqualTypeOf<ComplianceProofs | undefined>()
  expectTypeOf<ExecuteParameters['merkleProof']>().toEqualTypeOf<ComplianceProofs | undefined>()
  expectTypeOf<ExecuteXReserveBurnParameters['merkleProof']>().toEqualTypeOf<ComplianceProofs | undefined>()
})

test('bridge wallets accept minimal adapters and local proving without network capabilities', () => {
  expectTypeOf<Pick<WalletClient, 'executeTransaction'>>().toMatchTypeOf<AleoWalletClient>()
  expectTypeOf<Pick<WalletClient, 'executeTransaction' | 'account' | 'proving'>>().toMatchTypeOf<AleoWalletClient>()
  expectTypeOf<WalletClient>().toMatchTypeOf<AleoWalletClient>()
  expectTypeOf<ExecuteXReserveBurnParameters['publicClient']>().toEqualTypeOf<Client | undefined>()
})
