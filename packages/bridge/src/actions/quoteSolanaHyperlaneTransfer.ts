import { BridgeError } from '../errors/bridgeErrors.js'
import { quoteIgpGasPayment } from '../solana/igp.js'
import type { SolanaRpcReader } from '../solana/rpc.js'
import type { BridgeRegistry } from '../types/protocol.js'
import type { QuoteSolanaHyperlaneTransferParameters, SolanaHyperlaneTransferQuote } from '../types/solana.js'
import { parseDecimalAmount } from '../utils/units.js'
import { solanaRouteMetadata } from './solanaRouteMetadata.js'

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
