import { describe, expect, it } from 'vitest'
import { DEFAULT_BRIDGE_REGISTRY } from '../../src/registry/default.js'
import { validateBridgeRegistry } from '../../src/registry/validate.js'
import { BridgeError } from '../../src/errors/bridgeErrors.js'

describe('DEFAULT_BRIDGE_REGISTRY', () => {
  it('routes USDCx only through xReserve', () => {
    const usdcxRoutes = DEFAULT_BRIDGE_REGISTRY.routes.filter((route) =>
      route.sourceAssetId.includes('usdcx') || route.destinationAssetId.includes('usdcx'))
    expect(usdcxRoutes.length).toBeGreaterThan(0)
    expect(usdcxRoutes.every((route) => route.protocol === 'xreserve')).toBe(true)
  })

  it('routes the requested non-USDCx assets through Hyperlane', () => {
    for (const symbol of ['ETH', 'WBTC', 'USDT', 'SOL', 'ALEO', 'USAD']) {
      const assetIds = new Set(DEFAULT_BRIDGE_REGISTRY.assets
        .filter((asset) => asset.symbol === symbol)
        .map((asset) => asset.id))
      const routes = DEFAULT_BRIDGE_REGISTRY.routes.filter((route) =>
        assetIds.has(route.sourceAssetId) || assetIds.has(route.destinationAssetId))
      expect(routes.length, symbol).toBeGreaterThan(0)
      expect(routes.every((route) => route.protocol === 'hyperlane'), symbol).toBe(true)
    }
  })

  it('passes registry validation', () => {
    expect(validateBridgeRegistry(DEFAULT_BRIDGE_REGISTRY)).toBe(DEFAULT_BRIDGE_REGISTRY)
    expect(DEFAULT_BRIDGE_REGISTRY.routes[0]!.metadata?.xReserveContract)
      .toBe('0x8888888199b2Df864bf678259607d6D5EBb4e3Ce')
  })

  it('activates xReserve deposits and service-forwarded Aleo burns', () => {
    const xreserve = DEFAULT_BRIDGE_REGISTRY.routes.filter((route) => route.protocol === 'xreserve')
    expect(xreserve.every((route) => route.availability === 'active')).toBe(true)
    expect(xreserve.every((route) => route.metadata?.ethereumDestinationDomain === 0)).toBe(true)
    expect(xreserve.every((route) => route.metadata?.arcDestinationDomain === 26)).toBe(true)
  })

  it('pins executable Ethereum Hyperlane routes to a reviewed registry commit', () => {
    const inboundAssets = new Set(['ethereum/eth', 'ethereum/wbtc', 'ethereum/usdt'])
    const inbound = DEFAULT_BRIDGE_REGISTRY.routes.filter((route) =>
      route.protocol === 'hyperlane' && inboundAssets.has(route.sourceAssetId))
    expect(inbound.map((route) => route.sourceAssetId)).toEqual(expect.arrayContaining([
      'ethereum/eth',
      'ethereum/wbtc',
      'ethereum/usdt',
    ]))
    expect(inbound.every((route) => route.availability === 'active')).toBe(true)
    expect(inbound.every((route) => route.metadata?.registryCommit === '2621c16f2db1ccb46643265c110dac5ca2c7c51a')).toBe(true)
  })
})

describe('validateBridgeRegistry', () => {
  it('rejects dangling asset references', () => {
    expect(() => validateBridgeRegistry({
      ...DEFAULT_BRIDGE_REGISTRY,
      routes: [{
        ...DEFAULT_BRIDGE_REGISTRY.routes[0]!,
        sourceAssetId: 'missing/asset',
      }],
    })).toThrow(BridgeError)
  })

  it('rejects duplicate route ids', () => {
    const route = DEFAULT_BRIDGE_REGISTRY.routes[0]!
    expect(() => validateBridgeRegistry({
      ...DEFAULT_BRIDGE_REGISTRY,
      routes: [route, route],
    })).toThrow(/Duplicate bridge route id/)
  })

  it('rejects malformed address validation expressions', () => {
    expect(() => validateBridgeRegistry({
      ...DEFAULT_BRIDGE_REGISTRY,
      assets: [{ ...DEFAULT_BRIDGE_REGISTRY.assets[0]!, addressValidationRegex: '[' }],
      routes: [],
    })).toThrow(/invalid address validation regex/)
  })
})
