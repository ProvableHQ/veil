import { describe, expect, it } from 'vitest'
import { getProtocolAssets, getProtocolRoutes } from '../../src/actions/protocolDiscovery.js'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'

describe('getProtocolAssets', () => {
  it('filters by the client-facing environment, chain, and symbol', () => {
    expect(getProtocolAssets(DEFAULT_BRIDGE_REGISTRY, { environment: 'testnet' })
      .every((asset) => asset.chainId === 'aleo-testnet' || asset.chainId === 'sepolia')).toBe(true)
    expect(getProtocolAssets(DEFAULT_BRIDGE_REGISTRY, { chainId: 'ETHEREUM', symbol: 'usdc' })
      .map((asset) => asset.id)).toEqual(['ethereum/usdc'])
  })
})

describe('getProtocolRoutes', () => {
  it('returns directional xReserve routes for USDCx', () => {
    const routes = getProtocolRoutes(DEFAULT_BRIDGE_REGISTRY, {
      environment: 'mainnet',
      protocol: 'xreserve',
      symbol: 'USDCx',
    })
    expect(routes.map((route) => route.id)).toEqual([
      'xreserve:ethereum/usdc->aleo/usdcx',
      'xreserve:aleo/usdcx->ethereum/usdc',
    ])
  })

  it('filters directional Hyperlane routes by endpoints', () => {
    const routes = getProtocolRoutes(DEFAULT_BRIDGE_REGISTRY, {
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
