import { describe, it, expect } from 'vitest'
import { isAssetCode, resolveAssetCode } from '../../src/lib/asset-resolve.js'
import { BridgeError } from '../../src/errors/bridgeErrors.js'
import type { BridgeAssetSummary } from '../../src/types/bridge.js'

const CATALOG = [
  { id: '1', code: 'ALEO_MAINNET', chain: 'ALEO', symbol: 'ALEO', decimals: 6, native: true },
  { id: '2', code: 'USDC_ETH', chain: 'EVM:1', symbol: 'USDC', decimals: 6, native: false },
  { id: '3', code: 'USDC_ALEO', chain: 'ALEO', symbol: 'USDC', decimals: 6, native: false },
  { id: '4', code: 'USDCX_ALEO', chain: 'ALEO', symbol: 'USDCx', decimals: 6, native: false },
] as BridgeAssetSummary[]

describe('isAssetCode', () => {
  it('codes contain underscores; symbols do not', () => {
    expect(isAssetCode('ALEO_MAINNET')).toBe(true)
    expect(isAssetCode('ALEO')).toBe(false)
    expect(isAssetCode('USDCx')).toBe(false)
  })
})

describe('resolveAssetCode', () => {
  it('resolves a symbol within its chain, case-insensitively', () => {
    expect(resolveAssetCode(CATALOG, 'USDC', 'EVM:1')).toBe('USDC_ETH')
    expect(resolveAssetCode(CATALOG, 'usdc', 'ALEO')).toBe('USDC_ALEO')
    expect(resolveAssetCode(CATALOG, 'usdcx', 'ALEO')).toBe('USDCX_ALEO')
  })

  it('passes chain-qualified codes through verbatim', () => {
    expect(resolveAssetCode(CATALOG, 'ALEO_MAINNET', 'ALEO')).toBe('ALEO_MAINNET')
    // Even a code the catalog does not know — the API is the final validator.
    expect(resolveAssetCode(CATALOG, 'NEW_CODE', 'ALEO')).toBe('NEW_CODE')
  })

  it('throws with the chain symbol list when a symbol matches nothing', () => {
    expect(() => resolveAssetCode(CATALOG, 'SOL', 'ALEO')).toThrow(BridgeError)
    expect(() => resolveAssetCode(CATALOG, 'SOL', 'ALEO')).toThrow(/ALEO.*USDCx/s)
  })
})
