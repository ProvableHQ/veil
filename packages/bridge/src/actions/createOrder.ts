import type { Client } from '@provablehq/veil-core'
import { unwrapEnvelope } from '../utils/unwrapEnvelope.js'
import type { BridgeIntegrationType, BridgeOrderInstructions } from '../types/bridge.js'

/**
 * Parameters for `createOrder`. Route fields mirror the quote the order is
 * created from — echo them from the chosen `BridgeQuote`.
 *
 * @property providerId Id of the quoting provider (`quote.provider.id`).
 * @property srcChain Source chain identifier, as quoted.
 * @property destChain Destination chain identifier, as quoted.
 * @property srcAsset Chain-qualified source asset code, as quoted.
 * @property destAsset Chain-qualified destination asset code, as quoted.
 * @property amountIn Decimal source amount as a string, as quoted.
 * @property walletAddress Destination-chain address the provider pays out to.
 *   This is the payout recipient — NOT the source-chain signer.
 * @property quoteId The chosen quote's id (`quote.quoteId ?? quote.quoteOptionId`).
 * @property integrationType Optional provider integration type from the quote.
 * @property slippageBps Optional slippage tolerance in basis points (decimal string).
 * @property refundAddress Optional source-chain refund address; defaults
 *   server-side to the quote request's.
 * @property timezone Optional IANA timezone (e.g. `America/New_York`);
 *   hoisted to the `x-timezone` header by the transport.
 */
export type CreateOrderParameters = {
  providerId: string
  srcChain: string
  destChain: string
  srcAsset: string
  destAsset: string
  amountIn: string
  walletAddress: string
  quoteId: string
  integrationType?: BridgeIntegrationType | undefined
  slippageBps?: string | undefined
  refundAddress?: string | undefined
  timezone?: string | undefined
}

export type CreateOrderReturnType = BridgeOrderInstructions

/**
 * Creates a bridge order from a previously-fetched quote.
 *
 * Hits the bridge API and creates a real order with the provider — but moves
 * no funds: the order does nothing until its deposit instructions are
 * satisfied, and expires unfunded. The returned instructions carry the
 * deposit address, amount, chain, and (on memo-capable chains) a memo that
 * MUST be included or the deposit cannot be attributed.
 *
 * @param client A client whose transport is `httpBridge`.
 * @param params The quoted route plus payout address — see {@link CreateOrderParameters}.
 * @returns The deposit instructions for the new order.
 * @throws TransportError On a 4xx/5xx response (expired/unknown quote,
 *   invalid addresses).
 * @throws BridgeEnvelopeError When the response envelope is malformed.
 *
 * @example
 * const order = await createOrder(client, {
 *   providerId: quote.provider.id,
 *   srcChain: quote.srcChain, destChain: quote.destChain,
 *   srcAsset: quote.srcAsset, destAsset: quote.destAsset,
 *   amountIn: quote.amountIn,
 *   walletAddress: destinationAddress,
 *   quoteId: quote.quoteId!,
 * })
 */
export async function createOrder(
  client: Client,
  params: CreateOrderParameters,
): Promise<CreateOrderReturnType> {
  const response = await client.request({ method: 'createBridgeOrder', params })
  return unwrapEnvelope<BridgeOrderInstructions>(response)
}
