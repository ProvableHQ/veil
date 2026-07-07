import { describe, it, expect } from 'vitest'
import { aleoAssetProgram, DEFAULT_ALEO_ASSET_MAP } from '../../src/lib/aleo-asset.js'

describe('aleoAssetProgram', () => {
  it('maps ALEO_MAINNET to credits.aleo with 6 decimals', () => {
    expect(aleoAssetProgram('ALEO_MAINNET')).toEqual({ program: 'credits.aleo', decimals: 6, amountWidth: 'u64' })
  })

  it('maps token_registry assets with their live decimals', () => {
    expect(aleoAssetProgram('WBTC_ALEO')).toEqual({ program: 'token_registry.aleo', decimals: 8, amountWidth: 'u128' })
    expect(aleoAssetProgram('ETH_ALEO')).toEqual({ program: 'token_registry.aleo', decimals: 18, amountWidth: 'u128' })
    expect(aleoAssetProgram('USDC_ALEO')).toEqual({ program: 'token_registry.aleo', decimals: 6, amountWidth: 'u128' })
    expect(aleoAssetProgram('USDT_ALEO')).toEqual({ program: 'token_registry.aleo', decimals: 6, amountWidth: 'u128' })
    expect(aleoAssetProgram('WSOL_ALEO')).toEqual({ program: 'token_registry.aleo', decimals: 9, amountWidth: 'u128' })
  })

  it('maps USDCX_ALEO to usdcx_stablecoin.aleo with requiresMerkleProof', () => {
    expect(aleoAssetProgram('USDCX_ALEO')).toEqual({
      program: 'usdcx_stablecoin.aleo',
      decimals: 6,
      amountWidth: 'u128',
      requiresMerkleProof: true,
    })
  })

  it('maps USAD_ALEO to usad_stablecoin.aleo with requiresMerkleProof', () => {
    expect(aleoAssetProgram('USAD_ALEO')).toEqual({
      program: 'usad_stablecoin.aleo',
      decimals: 6,
      amountWidth: 'u128',
      requiresMerkleProof: true,
    })
  })

  it('accepts case-insensitive code lookup', () => {
    expect(aleoAssetProgram('aleo_mainnet')).toEqual({ program: 'credits.aleo', decimals: 6, amountWidth: 'u64' })
    expect(aleoAssetProgram('usdcx_aleo')).toEqual({
      program: 'usdcx_stablecoin.aleo',
      decimals: 6,
      amountWidth: 'u128',
      requiresMerkleProof: true,
    })
  })

  it('exposes DEFAULT_ALEO_ASSET_MAP for external extension', () => {
    expect(DEFAULT_ALEO_ASSET_MAP.ALEO_MAINNET).toBeDefined()
    expect(DEFAULT_ALEO_ASSET_MAP.USDCX_ALEO).toBeDefined()
  })

  it('matches caller-supplied maps case-insensitively on the key side too', () => {
    const custom = { new_token_aleo: { program: 'new_token.aleo', decimals: 6, amountWidth: 'u128' as const } }
    expect(aleoAssetProgram('NEW_TOKEN_ALEO', custom)).toEqual(custom.new_token_aleo)
    expect(aleoAssetProgram('new_token_aleo', custom)).toEqual(custom.new_token_aleo)
  })

  it('throws for an unknown asset with guidance toward /common/assets', () => {
    expect(() => aleoAssetProgram('NOT_AN_ASSET')).toThrow(/unknown.*aleo asset/i)
    expect(() => aleoAssetProgram('ALEO')).toThrow(/chain-qualified/i) // bare symbols are not codes
  })
})
