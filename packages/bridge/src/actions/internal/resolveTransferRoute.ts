import { BridgeError } from '../../errors/bridgeErrors.js'
import type {
  BridgeRegistry,
  BridgeTransferPlan,
  ProtocolBridgeAsset,
  ProtocolBridgeChain,
  ProtocolBridgeRoute,
} from '../../types/protocol.js'

/** Captures the registry entries that define a validated prepared route. */
export type ResolvedTransferRoute = {
  route: ProtocolBridgeRoute
  sourceAsset: ProtocolBridgeAsset
  destinationAsset: ProtocolBridgeAsset
  sourceChain: ProtocolBridgeChain
  destinationChain: ProtocolBridgeChain
}

/**
 * Resolves a prepared plan against the exact registry snapshot that created it.
 *
 * Pure and local; rejects stale or altered route, asset, and chain references
 * before a dispatcher selects any network or wallet capability.
 *
 * @param registry Reviewed deployment snapshot expected by the action.
 * @param plan Prepared transfer whose registry references are validated.
 * @returns Canonical route, asset, and chain entries from the registry.
 * @throws BridgeError When the plan is stale or its route topology was altered.
 * @example const route = resolveTransferRoute(registry, plan)
 */
export function resolveTransferRoute(
  registry: BridgeRegistry,
  plan: BridgeTransferPlan,
): ResolvedTransferRoute {
  if (plan.registryVersion !== registry.version) {
    throw new BridgeError(`Transfer plan uses registry ${plan.registryVersion}; expected ${registry.version}`)
  }
  const route = registry.routes.find((entry) => entry.id === plan.route.id)
  if (!route || route.protocol !== plan.protocol || plan.route.protocol !== plan.protocol) {
    throw new BridgeError(`Transfer plan route does not match the configured registry: ${plan.route.id}`)
  }
  if (route.sourceAssetId !== plan.sourceAsset.id || route.destinationAssetId !== plan.destinationAsset.id) {
    throw new BridgeError(`Transfer plan assets do not match configured route: ${route.id}`)
  }
  const sourceAsset = registry.assets.find((asset) => asset.id === route.sourceAssetId)
  const destinationAsset = registry.assets.find((asset) => asset.id === route.destinationAssetId)
  if (!sourceAsset || sourceAsset.chainId !== plan.sourceAsset.chainId
    || !destinationAsset || destinationAsset.chainId !== plan.destinationAsset.chainId) {
    throw new BridgeError(`Transfer plan asset chains do not match configured route: ${route.id}`)
  }
  const sourceChain = registry.chains.find((chain) => chain.id === sourceAsset.chainId)
  const destinationChain = registry.chains.find((chain) => chain.id === destinationAsset.chainId)
  if (!sourceChain || !destinationChain) {
    throw new BridgeError(`Transfer plan references an unknown chain: ${route.id}`)
  }
  return { route, sourceAsset, destinationAsset, sourceChain, destinationChain }
}
