import type { Client } from '@veil/core'
import { unwrapEnvelope } from '../utils/unwrapEnvelope.js'
import type { BridgeOrderStatusDto } from '../types/bridge.js'

/**
 * Parameters for `getOrder`.
 *
 * @property id Bridge order id, from `createOrder`.
 */
export type GetOrderParameters = { id: string }
export type GetOrderReturnType = BridgeOrderStatusDto

/**
 * Fetches the current status of a bridge order.
 *
 * Hits the bridge API; read-only. One snapshot — for a wait-until-done loop
 * use `waitForOrder`, and for the full step/provider-event history use
 * `getOrderAudit`.
 *
 * @param client A client whose transport is `httpBridge`.
 * @param params The order id.
 * @returns The order's status DTO — stage, deposit instructions, timeline.
 * @throws TransportError On a 4xx/5xx response (unknown order id).
 * @throws BridgeEnvelopeError When the response envelope is malformed.
 *
 * @example
 * const status = await getOrder(client, { id: order.orderId })
 */
export async function getOrder(
  client: Client,
  params: GetOrderParameters,
): Promise<GetOrderReturnType> {
  const response = await client.request({ method: 'getBridgeOrder', params })
  return unwrapEnvelope<BridgeOrderStatusDto>(response)
}
