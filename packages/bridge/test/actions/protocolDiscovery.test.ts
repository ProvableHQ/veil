import { describe, expect, it } from 'vitest'
import { getAssets } from '../../src/actions/getAssets.js'
import { getRoutes } from '../../src/actions/getRoutes.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'

describe('getAssets', () => {
  it('lists assets directly from the registry', () => {
    expect(DEFAULT_BRIDGE_REGISTRY.getAssets({ chainId: 'ETHEREUM', symbol: 'usdc' })
      .map((asset) => asset.id)).toEqual(['ethereum/usdc'])
  })

  it('filters by the client-facing environment, chain, and symbol', () => {
    expect(getAssets(DEFAULT_BRIDGE_REGISTRY, { environment: 'testnet' })
      .every((asset) => asset.chainId === 'aleo-testnet' || asset.chainId === 'sepolia')).toBe(true)
    expect(getAssets(DEFAULT_BRIDGE_REGISTRY, { chainId: 'ETHEREUM', symbol: 'usdc' })
      .map((asset) => asset.id)).toEqual(['ethereum/usdc'])
  })
})

describe('getRoutes', () => {
  it('lists routes directly from the registry', () => {
    expect(DEFAULT_BRIDGE_REGISTRY.getRoutes({
      environment: 'mainnet',
      protocol: 'xreserve',
      symbol: 'USDCx',
    }).map((route) => route.id)).toEqual([
      'xreserve:ethereum/usdc->aleo/usdcx',
      'xreserve:aleo/usdcx->ethereum/usdc',
    ])
  })

  it('returns directional xReserve routes for USDCx', () => {
    const routes = getRoutes(DEFAULT_BRIDGE_REGISTRY, {
      environment: 'mainnet',
      protocol: 'xreserve',
      symbol: 'USDCx',
    })
    expect(routes.map((route) => route.id)).toEqual([
      'xreserve:ethereum/usdc->aleo/usdcx',
      'xreserve:aleo/usdcx->ethereum/usdc',
      'xreserve:arc/usdc->aleo/usdcx',
    ])
  })

  it('filters directional Hyperlane routes by endpoints', () => {
    const routes = getRoutes(DEFAULT_BRIDGE_REGISTRY, {
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
