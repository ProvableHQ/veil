import { describe, expect, it } from 'vitest'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'

describe('getAssets', () => {
  it('lists assets directly from the registry', () => {
    expect(DEFAULT_BRIDGE_REGISTRY.getAssets({ chainId: 'ETHEREUM', symbol: 'usdc' })
      .map((asset) => asset.id)).toEqual(['ethereum/usdc'])
  })

  it('filters by the client-facing environment, chain, and symbol', () => {
    expect(DEFAULT_BRIDGE_REGISTRY.getAssets({ environment: 'testnet' })
      .every((asset) => asset.chainId === 'aleo-testnet' || asset.chainId === 'sepolia')).toBe(true)
    expect(DEFAULT_BRIDGE_REGISTRY.getAssets({ chainId: 'ETHEREUM', symbol: 'usdc' })
      .map((asset) => asset.id)).toEqual(['ethereum/usdc'])
  })
})

describe('getRoutes', () => {
  it('discovers only the three approved mainnet CCTP directions into Arc', () => {
    expect(DEFAULT_BRIDGE_REGISTRY.getRoutes({ protocol: 'cctp', environment: 'mainnet', symbol: 'USDC' })
      .map((route) => route.id)).toEqual([
        'cctp:ethereum/usdc->arc/usdc',
        'cctp:base/usdc->arc/usdc',
        'cctp:arbitrum/usdc->arc/usdc',
      ])
    expect(DEFAULT_BRIDGE_REGISTRY.getRoutes({ protocol: 'cctp', sourceChainId: 'arc' })).toEqual([])
    expect(DEFAULT_BRIDGE_REGISTRY.getRoutes({ protocol: 'cctp', environment: 'testnet' })).toEqual([])
    expect(DEFAULT_BRIDGE_REGISTRY.getRoutes({ protocol: 'cctp', symbol: 'USDCx' })).toEqual([])
    expect(DEFAULT_BRIDGE_REGISTRY.getRoutes({ protocol: 'cctp', sourceChainId: 'BASE', destinationChainId: 'ARC' })
      .map((route) => route.id)).toEqual(['cctp:base/usdc->arc/usdc'])
  })

  it('lists routes directly from the registry', () => {
    expect(DEFAULT_BRIDGE_REGISTRY.getRoutes({
      environment: 'mainnet',
      protocol: 'xreserve',
      symbol: 'USDCx',
    }).map((route) => route.id)).toEqual([
      'xreserve:ethereum/usdc->aleo/usdcx',
      'xreserve:aleo/usdcx->ethereum/usdc',
      'xreserve:arc/usdc->aleo/usdcx',
      'xreserve:aleo/usdcx->arc/usdc',
    ])
  })

  it('returns directional xReserve routes for USDCx', () => {
    const routes = DEFAULT_BRIDGE_REGISTRY.getRoutes({
      environment: 'mainnet',
      protocol: 'xreserve',
      symbol: 'USDCx',
    })
    expect(routes.map((route) => route.id)).toEqual([
      'xreserve:ethereum/usdc->aleo/usdcx',
      'xreserve:aleo/usdcx->ethereum/usdc',
      'xreserve:arc/usdc->aleo/usdcx',
      'xreserve:aleo/usdcx->arc/usdc',
    ])
  })

  it('filters directional Hyperlane routes by endpoints', () => {
    const routes = DEFAULT_BRIDGE_REGISTRY.getRoutes({
      environment: 'mainnet',
      protocol: 'hyperlane',
      sourceChainId: 'aleo',
      destinationChainId: 'solana',
    })
    expect(routes.map((route) => route.id)).toEqual([
      'hyperlane:aleo/sol->solana/sol',
      'hyperlane:aleo/aleo->solana/aleo',
    ])
  })
})
