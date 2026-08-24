import { BridgeError } from '../errors/bridgeErrors.js'
import type { BridgeRegistry } from '../types/protocol.js'

/**
 * Validates the referential integrity of a protocol bridge registry.
 *
 * Pure and local. Duplicate identifiers and dangling asset/chain references
 * throw before a client can prepare a misleading transfer plan.
 *
 * @param registry Registry supplied to `createBridgeClient`.
 * @returns The validated registry unchanged.
 * @throws BridgeError When identifiers are duplicated or references are missing.
 *
 * @example
 * const registry = validateBridgeRegistry(DEFAULT_BRIDGE_REGISTRY)
 */
export function validateBridgeRegistry(registry: BridgeRegistry): BridgeRegistry {
  if (!registry.version.trim()) throw new BridgeError('Bridge registry version must not be empty')

  const chainIds = new Set<string>()
  for (const chain of registry.chains) {
    if (chainIds.has(chain.id)) throw new BridgeError(`Duplicate bridge chain id: ${chain.id}`)
    chainIds.add(chain.id)
  }

  const assetIds = new Set<string>()
  for (const asset of registry.assets) {
    if (assetIds.has(asset.id)) throw new BridgeError(`Duplicate bridge asset id: ${asset.id}`)
    if (!chainIds.has(asset.chainId)) {
      throw new BridgeError(`Bridge asset ${asset.id} references unknown chain ${asset.chainId}`)
    }
    if (!Number.isInteger(asset.decimals) || asset.decimals < 0) {
      throw new BridgeError(`Bridge asset ${asset.id} has invalid decimals ${asset.decimals}`)
    }
    if (asset.addressValidationRegex) {
      try {
        new RegExp(asset.addressValidationRegex)
      } catch (cause) {
        throw new BridgeError(`Bridge asset ${asset.id} has an invalid address validation regex`, {
          cause,
        })
      }
    }
    assetIds.add(asset.id)
  }

  const routeIds = new Set<string>()
  for (const route of registry.routes) {
    if (routeIds.has(route.id)) throw new BridgeError(`Duplicate bridge route id: ${route.id}`)
    if (!assetIds.has(route.sourceAssetId)) {
      throw new BridgeError(`Bridge route ${route.id} references unknown source asset ${route.sourceAssetId}`)
    }
    if (!assetIds.has(route.destinationAssetId)) {
      throw new BridgeError(`Bridge route ${route.id} references unknown destination asset ${route.destinationAssetId}`)
    }
    const source = registry.assets.find((asset) => asset.id === route.sourceAssetId)!
    const destination = registry.assets.find((asset) => asset.id === route.destinationAssetId)!
    const sourceChain = registry.chains.find((chain) => chain.id === source.chainId)!
    const destinationChain = registry.chains.find((chain) => chain.id === destination.chainId)!
    if (sourceChain.environment !== route.environment || destinationChain.environment !== route.environment) {
      throw new BridgeError(`Bridge route ${route.id} crosses registry environments`)
    }
    routeIds.add(route.id)
  }

  return registry
}
