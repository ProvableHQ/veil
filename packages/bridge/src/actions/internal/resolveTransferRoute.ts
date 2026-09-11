import { BridgeError } from '../../errors/bridgeErrors.js'
import type {
  BridgeRegistry,
  BridgePlan,
  ProtocolBridgeAsset,
  ProtocolBridgeChain,
  ProtocolBridgeRoute,
} from '../../types/protocol.js'

/**
 * Groups the current registry entries that define one validated transfer direction.
 *
 * @property route Bridge provider and directional asset pairing.
 * @property sourceAsset Token or native asset committed on the source chain.
 * @property destinationAsset Token or native asset delivered on the destination chain.
 * @property sourceChain Source network and transaction family.
 * @property destinationChain Destination network and transaction family.
 */
export type ResolvedTransferRoute = {
  route: ProtocolBridgeRoute
  sourceAsset: ProtocolBridgeAsset
  destinationAsset: ProtocolBridgeAsset
  sourceChain: ProtocolBridgeChain
  destinationChain: ProtocolBridgeChain
}

/**
 * Resolves saved transfer details against the exact route catalog that created them.
 *
 * Rejects stale or altered route, asset, and chain references using only the
 * supplied registry and transfer details, before any network access or wallet
 * request occurs.
 *
 * @param registry Supported chains, assets, routes, and reviewed deployments expected by the action.
 * @param plan Route, assets, amount, and recipient whose registry references are validated.
 * @returns Canonical route, asset, and chain entries from the registry.
 * @throws BridgeError When the plan is stale or its route topology was altered.
 * @example const route = resolveTransferRoute(registry, plan)
 */
export function resolveTransferRoute(
  registry: BridgeRegistry,
  plan: BridgePlan,
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
