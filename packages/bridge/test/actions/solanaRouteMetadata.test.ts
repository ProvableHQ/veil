import { describe, expect, it } from 'vitest'
import { solanaRouteMetadata } from '../../src/actions/solanaRouteMetadata.js'
import { BridgeError } from '../../src/errors/bridgeErrors.js'
import type { BridgeRegistry } from '../../src/types/protocol.js'
import { SOLANA_ROUTE_ID, igpFixture, registryWithRoute, transferPlan } from '../fixtures/solanaHyperlane.js'

describe('solanaRouteMetadata', () => {
  it('rejects a plan built for a different protocol', () => {
    const registry = registryWithRoute()
    const plan = { ...transferPlan(registry), protocol: 'xreserve' as const }
    expect(() => solanaRouteMetadata(registry, plan)).toThrow(BridgeError)
  })

  it('rejects a plan built from a mismatched registry version', () => {
    const registry = registryWithRoute()
    const plan = { ...transferPlan(registry), registryVersion: 'not-the-configured-version' }
    expect(() => solanaRouteMetadata(registry, plan)).toThrow(BridgeError)
  })

  it('rejects a route that is not active', () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const inactiveRegistry: BridgeRegistry = {
      ...registry,
      routes: registry.routes.map((route) =>
        route.id === SOLANA_ROUTE_ID ? { ...route, availability: 'metadata-required' as const } : route,
      ),
    }
    expect(() => solanaRouteMetadata(inactiveRegistry, plan)).toThrow(BridgeError)
  })

  it('rejects metadata with a malformed IGP account address', () => {
    const registry = registryWithRoute({ igpAccount: 'not-a-solana-address' })
    const plan = transferPlan(registry)
    expect(() => solanaRouteMetadata(registry, plan)).toThrow(BridgeError)
  })

  it('returns the validated metadata for a well-formed active route', () => {
    const registry = registryWithRoute()
    const plan = transferPlan(registry)
    const metadata = solanaRouteMetadata(registry, plan)
    expect(metadata.igpAccount).toBe(igpFixture.address)
    expect(metadata.destinationDomain).toBe(1634493807)
    expect(metadata.destinationGasAmount).toBe('464000')
  })
})
