import { BridgeError } from '../../errors/bridgeErrors.js'
import type { BridgeRegistry, BridgePlan } from '../../types/protocol.js'
import type { SolanaHyperlaneRouteMetadata } from '../../types/solana.js'

// Base58, excluding the visually ambiguous 0/O/I/l — matches how Solana
// encodes a 32-byte account or program public key.
const SOLANA_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function requirePubkey(value: unknown, field: string, routeId: string): string {
  if (typeof value !== 'string' || !SOLANA_PUBKEY.test(value)) {
    throw new BridgeError(`Solana Hyperlane route has an invalid ${field}: ${routeId}`)
  }
  return value
}

/**
 * Validates transfer details against the registry's Solana Hyperlane route and
 * returns its reviewed deployment metadata.
 *
 * Confirms the plan's protocol, registry version, route presence, asset
 * pairing, and availability, then validates each metadata field without
 * contacting Solana or requesting a signature. These checks prevent an
 * incomplete or stale deployment snapshot from becoming an account list for a
 * signed Solana transaction.
 *
 * @param registry Supported assets and reviewed Solana Hyperlane deployment accounts.
 * @param plan Route, amount, and recipient selected for the transfer.
 * @returns The route's validated Solana Hyperlane deployment metadata.
 * @throws BridgeError When the plan is not a Hyperlane plan, was built from a
 *   different registry version, the route is missing from the registry, its
 *   assets do not match the plan, it is not active, or its metadata is
 *   absent or malformed.
 *
 * @example
 * const metadata = solanaRouteMetadata(registry, plan)
 */
export function solanaRouteMetadata(
  registry: BridgeRegistry,
  plan: BridgePlan,
): SolanaHyperlaneRouteMetadata {
  if (plan.protocol !== 'hyperlane' || plan.route.protocol !== 'hyperlane') {
    throw new BridgeError('Solana Hyperlane actions require a Hyperlane transfer plan')
  }
  if (plan.registryVersion !== registry.version) {
    throw new BridgeError(`Transfer plan uses registry ${plan.registryVersion}; expected ${registry.version}`)
  }
  // Resolve the current registry entry rather than trusting metadata copied
  // into an older plan after the application or registry has changed.
  const route = registry.routes.find((entry) => entry.id === plan.route.id)
  if (!route || route.protocol !== 'hyperlane') {
    throw new BridgeError(`Hyperlane route is not present in the configured registry: ${plan.route.id}`)
  }
  if (route.sourceAssetId !== plan.sourceAsset.id || route.destinationAssetId !== plan.destinationAsset.id) {
    throw new BridgeError(`Transfer plan assets do not match configured route: ${route.id}`)
  }
  if (route.availability !== 'active') {
    throw new BridgeError(`Hyperlane route is not executable: ${route.id}`)
  }
  // Every address below participates in instruction account ordering. Reject
  // the entire route instead of letting a missing field become a bad public key.
  const metadata = route.metadata
  if (!metadata) throw new BridgeError(`Solana Hyperlane route metadata is missing: ${plan.route.id}`)

  const routeId = plan.route.id
  const warpProgramAddress = requirePubkey(metadata.warpProgramAddress, 'warpProgramAddress', routeId)
  const tokenPda = requirePubkey(metadata.tokenPda, 'tokenPda', routeId)
  const nativeCollateralPda = requirePubkey(metadata.nativeCollateralPda, 'nativeCollateralPda', routeId)
  const dispatchAuthorityPda = requirePubkey(metadata.dispatchAuthorityPda, 'dispatchAuthorityPda', routeId)
  const mailboxProgramAddress = requirePubkey(metadata.mailboxProgramAddress, 'mailboxProgramAddress', routeId)
  const mailboxOutboxPda = requirePubkey(metadata.mailboxOutboxPda, 'mailboxOutboxPda', routeId)
  const igpProgramAddress = requirePubkey(metadata.igpProgramAddress, 'igpProgramAddress', routeId)
  const igpProgramDataPda = requirePubkey(metadata.igpProgramDataPda, 'igpProgramDataPda', routeId)
  const igpAccount = requirePubkey(metadata.igpAccount, 'igpAccount', routeId)
  const splNoopProgramAddress = requirePubkey(metadata.splNoopProgramAddress, 'splNoopProgramAddress', routeId)

  const igpOverheadAccountRaw = metadata.igpOverheadAccount
  const igpOverheadAccount = igpOverheadAccountRaw == null
    ? undefined
    : requirePubkey(igpOverheadAccountRaw, 'igpOverheadAccount', routeId)

  const destinationDomain = metadata.destinationDomain
  if (
    typeof destinationDomain !== 'number'
    || !Number.isInteger(destinationDomain)
    || destinationDomain < 0
    || destinationDomain > 0xffff_ffff
  ) {
    throw new BridgeError(`Solana Hyperlane route has an invalid destinationDomain: ${routeId}`)
  }

  const destinationGasAmount = metadata.destinationGasAmount
  if (typeof destinationGasAmount !== 'string' || !/^\d+$/.test(destinationGasAmount)) {
    throw new BridgeError(`Solana Hyperlane route has an invalid destinationGasAmount: ${routeId}`)
  }

  // Provenance does not prove the live accounts are unchanged, but it makes a
  // reviewed deployment reproducible across implementations and languages.
  const registryCommit = metadata.registryCommit
  if (typeof registryCommit !== 'string' || !/^[0-9a-f]{40}$/i.test(registryCommit)) {
    throw new BridgeError(`Solana Hyperlane route has an invalid registryCommit: ${routeId}`)
  }

  const solanaReviewedAt = metadata.solanaReviewedAt
  if (typeof solanaReviewedAt !== 'string' || Number.isNaN(Date.parse(solanaReviewedAt))) {
    throw new BridgeError(`Solana Hyperlane route has an invalid solanaReviewedAt: ${routeId}`)
  }

  const solanaConfigSource = metadata.solanaConfigSource
  if (typeof solanaConfigSource !== 'string' || solanaConfigSource.length === 0) {
    throw new BridgeError(`Solana Hyperlane route has an invalid solanaConfigSource: ${routeId}`)
  }

  return {
    warpProgramAddress,
    tokenPda,
    nativeCollateralPda,
    dispatchAuthorityPda,
    mailboxProgramAddress,
    mailboxOutboxPda,
    igpProgramAddress,
    igpProgramDataPda,
    igpAccount,
    ...(igpOverheadAccount == null ? {} : { igpOverheadAccount }),
    splNoopProgramAddress,
    destinationDomain,
    destinationGasAmount,
    registryCommit,
    solanaReviewedAt,
    solanaConfigSource,
  }
}
