import type { Client } from '@provablehq/veil-core'
import type { BridgeRegistry } from '../types/protocol.js'
import type { AleoHyperlaneGasQuote, QuoteAleoHyperlaneGasPaymentParameters } from '../types/aleo.js'
import { runQuoteAleoHyperlaneGasPayment as quoteGasPayment } from './internal/aleoHyperlane.js'

/**
 * Quotes the exact Hyperlane hook payment for an Aleo-origin transfer.
 *
 * Reads live hook configuration without signing or moving funds.
 *
 * @param registry Reviewed route snapshot.
 * @param client Aleo client used for mapping reads.
 * @param params Aleo-origin route to quote.
 * @returns Oracle components and exact payment in microcredits.
 * @throws BridgeError When the route or on-chain gas configuration is invalid.
 * @example const quote = await quoteAleoHyperlaneGasPayment(registry, client, { routeId })
 */
export async function quoteAleoHyperlaneGasPayment(
  registry: BridgeRegistry,
  client: Client,
  params: QuoteAleoHyperlaneGasPaymentParameters,
): Promise<AleoHyperlaneGasQuote> {
  return quoteGasPayment(registry, client, params)
}
