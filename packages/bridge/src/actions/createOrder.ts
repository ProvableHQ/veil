import type { Client } from '@veil/core'
import { unwrapEnvelope } from '../utils/unwrapEnvelope.js'
import type { BridgeIntegrationType, BridgeOrderInstructions } from '../types/bridge.js'

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
  /** IANA timezone string (e.g. `America/New_York`); hoisted to `x-timezone` header by the transport. */
  timezone?: string | undefined
}

export type CreateOrderReturnType = BridgeOrderInstructions

export async function createOrder(
  client: Client,
  params: CreateOrderParameters,
): Promise<CreateOrderReturnType> {
  const response = await client.request({ method: 'createBridgeOrder', params })
  return unwrapEnvelope<BridgeOrderInstructions>(
    response as { data: BridgeOrderInstructions; meta?: Record<string, unknown> },
    { keepMeta: false },
  )
}
