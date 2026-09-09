import type { EvmClient } from '../connections/evm.js'
import type { BridgeRegistry } from '../types/protocol.js'
import type { EvmHyperlaneTransferQuote, QuoteEvmHyperlaneTransferParameters } from '../types/evm.js'
import { runQuoteEvmHyperlaneTransfer as quoteTransfer } from './internal/evmHyperlane.js'

/**
 * Quotes an Ethereum-origin Hyperlane Warp Route transfer.
 *
 * Reads live router state without requesting a signature or moving funds.
 *
 * @param registry Reviewed deployment snapshot.
 * @param client EVM client used for chain reads.
 * @param params Prepared transfer and encoded recipient.
 * @returns Atomic transfer and fee requirements.
 * @throws BridgeError When route metadata, chain state, or the router quote is invalid.
 * @example const quote = await quoteEvmHyperlaneTransfer(registry, client, { plan, recipientBytes32 })
 */
export async function quoteEvmHyperlaneTransfer(
  registry: BridgeRegistry,
  client: EvmClient,
  params: QuoteEvmHyperlaneTransferParameters,
): Promise<EvmHyperlaneTransferQuote> {
  return quoteTransfer(registry, client, params)
}
