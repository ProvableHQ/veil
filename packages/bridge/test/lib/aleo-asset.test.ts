import { describe, it, expect } from 'vitest'
import { aleoAssetProgram, DEFAULT_ALEO_ASSET_MAP } from '../../src/lib/aleo-asset.js'

describe('aleoAssetProgram', () => {
  it('maps ALEO to credits.aleo', () => {
    expect(aleoAssetProgram('ALEO')).toEqual({ program: 'credits.aleo' })
  })

  it('maps WBTC/WETH/WUSDC/WSOL to token_registry.aleo', () => {
    expect(aleoAssetProgram('WBTC')).toEqual({ program: 'token_registry.aleo' })
    expect(aleoAssetProgram('WETH')).toEqual({ program: 'token_registry.aleo' })
    expect(aleoAssetProgram('WUSDC')).toEqual({ program: 'token_registry.aleo' })
    expect(aleoAssetProgram('WSOL')).toEqual({ program: 'token_registry.aleo' })
  })

  it('maps USDCX to usdcx_stablecoin.aleo with requiresMerkleProof', () => {
    expect(aleoAssetProgram('USDCX')).toEqual({
      program: 'usdcx_stablecoin.aleo',
      requiresMerkleProof: true,
    })
  })

  it('maps USAD to usad_stablecoin.aleo with requiresMerkleProof', () => {
    expect(aleoAssetProgram('USAD')).toEqual({
      program: 'usad_stablecoin.aleo',
      requiresMerkleProof: true,
    })
  })

  it('accepts case-insensitive symbol lookup', () => {
    expect(aleoAssetProgram('aleo')).toEqual({ program: 'credits.aleo' })
    expect(aleoAssetProgram('usdcx')).toEqual({
      program: 'usdcx_stablecoin.aleo',
      requiresMerkleProof: true,
    })
  })

  it('exposes DEFAULT_ALEO_ASSET_MAP for external extension', () => {
    expect(DEFAULT_ALEO_ASSET_MAP.ALEO).toBeDefined()
    expect(DEFAULT_ALEO_ASSET_MAP.USDCX).toBeDefined()
  })

  it('throws for an unknown asset', () => {
    expect(() => aleoAssetProgram('NOT_AN_ASSET')).toThrow(/unknown.*aleo asset/i)
  })
})
