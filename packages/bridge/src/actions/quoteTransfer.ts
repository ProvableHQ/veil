import { BridgeError } from '../errors/bridgeErrors.js'
import {
  requireAleoClient,
  requireEvmClient,
  requireEvmClientWithWallet,
  requireSolanaClient,
  type BridgeChainClients,
} from '../connections/resolve.js'
import type { BridgeRegistry } from '../types/protocol.js'
import type { QuoteTransferParameters, TransferQuote } from '../types/transfer.js'
import { aleoAddressToBytes32 } from '../utils/xreserve.js'
import { quoteAleoHyperlaneGasPayment } from './quoteAleoHyperlaneGasPayment.js'
import { quoteEvmHyperlaneTransfer } from './quoteEvmHyperlaneTransfer.js'
import { quoteEvmXReserveTransfer } from './quoteEvmXReserveTransfer.js'
import { quoteSolanaHyperlaneTransfer } from './quoteSolanaHyperlaneTransfer.js'
import { resolveTransferRoute } from './internal/resolveTransferRoute.js'

/**
 * Quotes a prepared transfer through its configured protocol and source chain.
 *
 * Reads live chain state where the route requires it. Aleo xReserve burns have
 * no separate live quote and return the estimate embedded in the prepared plan.
 *
 * @param registry Reviewed deployment snapshot.
 * @param clients Materialized chain clients keyed by registry chain id.
 * @param params Prepared transfer to quote.
 * @returns A discriminated quote containing route-specific atomic values.
 * @throws BridgeError When the route shape is unsupported or its source client is unavailable.
 * @example const quote = await quoteTransfer(registry, clients, { plan })
 */
export async function quoteTransfer(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  params: QuoteTransferParameters,
): Promise<TransferQuote> {
  const chain = resolveTransferRoute(registry, params.plan).sourceChain
  const chainId = chain.id

  if (params.plan.protocol === 'hyperlane' && chain.family === 'evm') {
    const client = requireEvmClient(registry, clients, chainId)
    const quote = await quoteEvmHyperlaneTransfer(registry, client, {
      plan: params.plan,
      recipientBytes32: aleoAddressToBytes32(params.plan.recipient),
    })
    return { kind: 'evm-hyperlane', ...quote }
  }
  if (params.plan.protocol === 'hyperlane' && chain.family === 'solana') {
    const quote = await quoteSolanaHyperlaneTransfer(
      registry,
      requireSolanaClient(registry, clients, chainId),
      params,
    )
    return { kind: 'solana-hyperlane', ...quote }
  }
  if (params.plan.protocol === 'hyperlane' && chain.family === 'aleo') {
    const quote = await quoteAleoHyperlaneGasPayment(
      registry,
      requireAleoClient(registry, clients, chainId).publicClient,
      { routeId: params.plan.route.id },
    )
    return { kind: 'aleo-hyperlane', ...quote }
  }
  if (params.plan.protocol === 'xreserve' && chain.family === 'evm') {
    const quote = await quoteEvmXReserveTransfer(
      registry,
      requireEvmClientWithWallet(registry, clients, chainId, 'quote xReserve transfer'),
      params,
    )
    return { kind: 'evm-xreserve', ...quote }
  }
  if (params.plan.protocol === 'xreserve' && chain.family === 'aleo') {
    return { kind: 'aleo-xreserve', ...params.plan.quote }
  }

  throw new BridgeError(`Unsupported ${params.plan.protocol} source chain family: ${chain.family}`)
}
