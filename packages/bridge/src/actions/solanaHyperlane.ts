import { BridgeError } from '../errors/bridgeErrors.js'
import { quoteIgpGasPayment } from '../solana/igp.js'
import type { SolanaRpcReader } from '../solana/rpc.js'
import type { BridgeRegistry, BridgeTransferPlan } from '../types/protocol.js'
import type {
  QuoteSolanaHyperlaneTransferParameters,
  SolanaHyperlaneRouteMetadata,
  SolanaHyperlaneTransferQuote,
} from '../types/solana.js'
import { parseDecimalAmount } from '../utils/units.js'

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
 * Validates a prepared transfer plan against the registry's Solana Hyperlane
 * route and returns its reviewed deployment metadata.
 *
 * Pure and local: confirms the plan's protocol, registry version, route
 * presence, asset pairing, and availability, then narrows and validates each
 * metadata field. Modeled on `routeMetadata` in `evmHyperlane.ts`.
 *
 * @param registry Reviewed deployment snapshot used to validate the prepared plan.
 * @param plan Prepared transfer plan naming the Solana Hyperlane route.
 * @returns The route's validated Solana Hyperlane deployment metadata.
 * @throws BridgeError When the plan is not a Hyperlane plan, was built from a
 *   different registry version, the route is missing from the registry, its
 *   assets do not match the plan, it is not active, or its metadata is
 *   absent or malformed.
 */
export function solanaRouteMetadata(
  registry: BridgeRegistry,
  plan: BridgeTransferPlan,
): SolanaHyperlaneRouteMetadata {
  if (plan.protocol !== 'hyperlane' || plan.route.protocol !== 'hyperlane') {
    throw new BridgeError('Solana Hyperlane actions require a Hyperlane transfer plan')
  }
  if (plan.registryVersion !== registry.version) {
    throw new BridgeError(`Transfer plan uses registry ${plan.registryVersion}; expected ${registry.version}`)
  }
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

/**
 * Quotes a Solana-to-Aleo Hyperlane Warp Route transfer.
 *
 * Reads the reviewed route's terminal interchain gas paymaster account
 * through the injected Solana RPC reader and applies its on-chain gas-oracle
 * quote formula (SEALEVEL_NOTES.md §4). The call reads live chain state over
 * the network but never signs or submits a transaction.
 *
 * @param registry Reviewed deployment snapshot used to validate the prepared plan.
 * @param rpc Solana JSON-RPC reader used for the on-chain IGP account read.
 * @param params Prepared plan naming the Solana Hyperlane route to quote.
 * @returns Atomic lamport transfer amount, IGP gas payment, network fee, and their total.
 * @throws BridgeError When the route is not an active Solana Hyperlane source
 *   route, its metadata is incomplete or malformed, or the configured IGP
 *   account does not exist.
 *
 * @example
 * const quote = await quoteSolanaHyperlaneTransfer(registry, rpc, { plan })
 */
export async function quoteSolanaHyperlaneTransfer(
  registry: BridgeRegistry,
  rpc: SolanaRpcReader,
  params: QuoteSolanaHyperlaneTransferParameters,
): Promise<SolanaHyperlaneTransferQuote> {
  const metadata = solanaRouteMetadata(registry, params.plan)
  const amountLamports = parseDecimalAmount(params.plan.amountIn, params.plan.sourceAsset.decimals)

  const igpAccountData = await rpc.getAccountData(metadata.igpAccount)
  if (!igpAccountData) {
    throw new BridgeError(`Solana IGP account does not exist: ${metadata.igpAccount}`)
  }
  const igpPaymentLamports = quoteIgpGasPayment({
    igpAccountData,
    destinationDomain: metadata.destinationDomain,
    gasAmount: BigInt(metadata.destinationGasAmount),
  })

  // Two ed25519 signatures at 5,000 lamports each — the sender (fee payer)
  // and the freshly generated unique-message keypair (SEALEVEL_NOTES.md §2,
  // slots 6 and 7) — at Solana's fixed per-signature fee.
  const networkFeeLamports = 10_000n

  return {
    routeId: params.plan.route.id,
    amountLamports,
    igpPaymentLamports,
    networkFeeLamports,
    totalLamports: amountLamports + igpPaymentLamports + networkFeeLamports,
  }
}
