import { describe, it, expect } from 'vitest'
import { chainDisplayName, KNOWN_CHAIN_NAMES, resolveChainId } from '../../src/lib/chain-names.js'

describe('chainDisplayName', () => {
  it('names the chains the bridge serves', () => {
    expect(chainDisplayName('ALEO')).toBe('Aleo')
    expect(chainDisplayName('EVM:1')).toBe('Ethereum')
    expect(chainDisplayName('EVM:8453')).toBe('Base')
    expect(chainDisplayName('EVM:42161')).toBe('Arbitrum')
    expect(chainDisplayName('SOLANA')).toBe('Solana')
  })

  it('falls back to the identifier for unknown chains', () => {
    expect(chainDisplayName('EVM:999')).toBe('EVM:999')
    expect(chainDisplayName('NOT_A_CHAIN')).toBe('NOT_A_CHAIN')
  })

  it('is case-sensitive, like the API identifiers themselves', () => {
    expect(chainDisplayName('aleo')).toBe('aleo') // not the API id → fallback
  })

  it('exposes the map for UIs that render pickers', () => {
    expect(Object.keys(KNOWN_CHAIN_NAMES).length).toBeGreaterThanOrEqual(10)
  })
})

describe('resolveChainId', () => {
  it('resolves display names to identifiers, case-insensitively', () => {
    expect(resolveChainId('Solana')).toBe('SOLANA')
    expect(resolveChainId('ethereum')).toBe('EVM:1')
    expect(resolveChainId('Base')).toBe('EVM:8453')
  })

  it('normalizes identifier casing and passes unknowns through', () => {
    expect(resolveChainId('evm:42161')).toBe('EVM:42161')
    expect(resolveChainId('SOLANA')).toBe('SOLANA')
    expect(resolveChainId('NEWCHAIN')).toBe('NEWCHAIN')
  })
})
