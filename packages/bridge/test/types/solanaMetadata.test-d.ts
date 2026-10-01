import { describe, expectTypeOf, it } from 'vitest'
import type {
  SolanaHyperlaneRouteMetadata,
  SolanaHyperlaneSplRouteMetadata,
  SolanaHyperlaneTransferMetadata,
} from '@provablehq/aleo-bridge-sdk'
import {
  buildTransferRemoteInstruction,
  type BuildTransferRemoteParameters,
  type SolanaAccountMeta,
} from '@provablehq/aleo-bridge-sdk/solana'

// A pre-SPL consumer's complete literal: no routerType and no new fields.
// Requiring any additional native field must break this regression fixture.
const address = '11111111111111111111111111111111'
const native: SolanaHyperlaneRouteMetadata = {
  warpProgramAddress: address,
  tokenPda: address,
  nativeCollateralPda: address,
  dispatchAuthorityPda: address,
  mailboxProgramAddress: address,
  mailboxOutboxPda: address,
  igpProgramAddress: address,
  igpProgramDataPda: address,
  igpAccount: address,
  splNoopProgramAddress: address,
  destinationDomain: 1634493807,
  destinationGasAmount: '464000',
  registryCommit: '418056e21734d26a7d14692e0ec5e902cc9e86bf',
  solanaReviewedAt: '2026-08-28T00:00:00Z',
  solanaConfigSource: 'hyperlane-registry@418056e2:deployments/warp_routes/SOL/aleo-config.yaml',
}
declare const legacyParams: BuildTransferRemoteParameters
declare const transfer: SolanaHyperlaneTransferMetadata
declare const spl: SolanaHyperlaneSplRouteMetadata

describe('Solana metadata public API compatibility', () => {
  it('preserves required native collateral access and interface extension', () => {
    interface AppRoute extends SolanaHyperlaneRouteMetadata { label: string }
    expectTypeOf(native.nativeCollateralPda).toEqualTypeOf<string>()
    expectTypeOf<AppRoute['nativeCollateralPda']>().toEqualTypeOf<string>()
    expectTypeOf<'nativeCollateralPda'>().toMatchTypeOf<keyof SolanaHyperlaneRouteMetadata>()
  })

  it('keeps bare builder parameters native and accepts legacy calls', () => {
    interface AppTransfer extends BuildTransferRemoteParameters { label: string }
    expectTypeOf(legacyParams.metadata.nativeCollateralPda).toEqualTypeOf<string>()
    expectTypeOf<AppTransfer['metadata']>().toEqualTypeOf<SolanaHyperlaneRouteMetadata>()
    expectTypeOf(buildTransferRemoteInstruction(legacyParams)).toEqualTypeOf<
      Promise<{ programAddress: string; accounts: SolanaAccountMeta[]; data: Uint8Array }>
    >()
  })

  it('preserves native parameters derived from the exported builder signature', () => {
    type InferredParameters = Parameters<typeof buildTransferRemoteInstruction>[0]
    expectTypeOf<InferredParameters>().toEqualTypeOf<BuildTransferRemoteParameters>()
    const collateral = (params: InferredParameters): string => params.metadata.nativeCollateralPda
    expectTypeOf(collateral).returns.toEqualTypeOf<string>()
  })

  it('accepts native metadata without a discriminator and narrows both transfer kinds', () => {
    expectTypeOf(native).toMatchTypeOf<SolanaHyperlaneTransferMetadata>()
    if (transfer.routerType === 'spl-collateral') {
      expectTypeOf(transfer.collateralMintAddress).toEqualTypeOf<string>()
      expectTypeOf(transfer.splTokenProgramAddress).toEqualTypeOf<string>()
      expectTypeOf(transfer.escrowPda).toEqualTypeOf<string>()
      // @ts-expect-error SPL collateral does not hold native SOL collateral.
      transfer.nativeCollateralPda
    } else {
      expectTypeOf(transfer.nativeCollateralPda).toEqualTypeOf<string>()
      // @ts-expect-error Native collateral has no SPL mint.
      transfer.collateralMintAddress
    }
  })

  it('accepts explicitly typed SPL and combined builder parameters', () => {
    const params: BuildTransferRemoteParameters<SolanaHyperlaneSplRouteMetadata> = {
      ...legacyParams, metadata: spl,
    }
    expectTypeOf(params.metadata.collateralMintAddress).toEqualTypeOf<string>()
    expectTypeOf(buildTransferRemoteInstruction(params)).toEqualTypeOf<
      ReturnType<typeof buildTransferRemoteInstruction>
    >()
    const combined: BuildTransferRemoteParameters<SolanaHyperlaneTransferMetadata> = {
      ...legacyParams, metadata: transfer,
    }
    buildTransferRemoteInstruction(combined)
    buildTransferRemoteInstruction({ ...legacyParams, metadata: { ...native, routerType: 'native' } })
  })

  it('requires native collateral in legacy metadata and builder parameters', () => {
    const { nativeCollateralPda: _collateral, ...incomplete } = native
    // @ts-expect-error Native metadata must retain its required collateral PDA.
    const missingCollateral: SolanaHyperlaneRouteMetadata = incomplete
    // @ts-expect-error Bare builder parameters retain the native-only contract.
    const wrongKind: BuildTransferRemoteParameters = { ...legacyParams, metadata: spl }
    void missingCollateral
    void wrongKind
  })

  it('requires the SPL discriminator, token program, mint, and escrow', () => {
    const { routerType: _kind, ...noKind } = spl
    const { splTokenProgramAddress: _program, ...noProgram } = spl
    const { collateralMintAddress: _mint, ...noMint } = spl
    const { escrowPda: _escrow, ...noEscrow } = spl
    // @ts-expect-error SPL metadata must identify its collateral mechanism.
    const missingKind: SolanaHyperlaneTransferMetadata = noKind
    // @ts-expect-error SPL metadata must specify the token program.
    const missingProgram: SolanaHyperlaneSplRouteMetadata = noProgram
    // @ts-expect-error SPL metadata must specify the collateral mint.
    const missingMint: SolanaHyperlaneSplRouteMetadata = noMint
    // @ts-expect-error SPL metadata must specify the escrow account.
    const missingEscrow: SolanaHyperlaneSplRouteMetadata = noEscrow
    void [missingKind, missingProgram, missingMint, missingEscrow]
  })
})
