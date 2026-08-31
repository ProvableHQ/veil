import { BridgeError } from '../errors/bridgeErrors.js'
import type { BridgeRegistry } from '../types/protocol.js'
import type { SolanaHyperlaneRouteMetadata } from '../types/solana.js'

// Required `SolanaHyperlaneRouteMetadata` fields an active Solana-source
// Hyperlane route must carry. `igpOverheadAccount` is intentionally excluded:
// it is optional on the type, present only when the reviewed deployment
// wraps its IGP in an `OverheadIgp` layer (see the type's docblock).
const REQUIRED_SOLANA_HYPERLANE_METADATA_FIELDS: readonly Exclude<
  keyof SolanaHyperlaneRouteMetadata,
  'igpOverheadAccount'
>[] = [
  'warpProgramAddress',
  'tokenPda',
  'nativeCollateralPda',
  'dispatchAuthorityPda',
  'mailboxProgramAddress',
  'mailboxOutboxPda',
  'igpProgramAddress',
  'igpProgramDataPda',
  'igpAccount',
  'splNoopProgramAddress',
  'destinationDomain',
  'destinationGasAmount',
  'registryCommit',
  'solanaReviewedAt',
  'solanaConfigSource',
]

/**
 * Reports whether route metadata carries every required
 * `SolanaHyperlaneRouteMetadata` field with the expected primitive type.
 *
 * Pure and local. Checks field presence and shape only; format-level
 * validation (address charset, digit strings, commit hash shape) is the
 * job of `solanaRouteMetadata` in `actions/solanaHyperlane.ts` at plan time.
 */
function hasCompleteSolanaHyperlaneMetadata(
  metadata: Readonly<Record<string, string | number | boolean>> | undefined,
): boolean {
  if (!metadata) return false
  return REQUIRED_SOLANA_HYPERLANE_METADATA_FIELDS.every((field) => {
    const value = metadata[field]
    return field === 'destinationDomain' ? typeof value === 'number' : typeof value === 'string' && value.length > 0
  })
}

/**
 * Validates the referential integrity of a protocol bridge registry.
 *
 * Pure and local. Duplicate identifiers and dangling asset/chain references
 * throw before a client can prepare a misleading transfer plan. An active
 * Hyperlane route sourced from a Solana-family chain additionally must carry
 * a complete `SolanaHyperlaneRouteMetadata` object, so a route cannot be
 * flipped to `active` ahead of its metadata being reviewed and filled in.
 *
 * @param registry Registry supplied to `createBridgeClient`.
 * @returns The validated registry unchanged.
 * @throws BridgeError When identifiers are duplicated, references are
 *   missing, or an active Solana-source Hyperlane route is missing required
 *   Sealevel deployment metadata.
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
    if (
      route.protocol === 'hyperlane'
      && route.availability === 'active'
      && sourceChain.family === 'solana'
      && !hasCompleteSolanaHyperlaneMetadata(route.metadata)
    ) {
      throw new BridgeError(`Bridge route ${route.id} is active but missing required Solana Hyperlane metadata`)
    }
    routeIds.add(route.id)
  }

  return registry
}
