import type { Client } from '@provablehq/veil-core'
import { unwrapEnvelope } from '../utils/unwrapEnvelope.js'
import type { BridgeOrderAuditDto } from '../types/bridge.js'

/**
 * Parameters for `getOrderAudit`.
 *
 * @property id Bridge order id, from `createOrder`.
 */
export type GetOrderAuditParameters = { id: string }
export type GetOrderAuditReturnType = BridgeOrderAuditDto

/**
 * Fetches a bridge order's status plus its full audit trail.
 *
 * Hits the bridge API; read-only. Extends the status DTO with the per-step
 * workflow history and raw provider events — reach for it when diagnosing a
 * stuck or failed order; `getOrder` suffices for routine tracking.
 *
 * @param client A client whose transport is `httpBridge`.
 * @param params The order id.
 * @returns The order's audit DTO — status plus steps and provider events.
 * @throws TransportError On a 4xx/5xx response (unknown order id).
 * @throws BridgeEnvelopeError When the response envelope is malformed.
 *
 * @example
 * const audit = await getOrderAudit(client, { id: order.orderId })
 */
export async function getOrderAudit(
  client: Client,
  params: GetOrderAuditParameters,
): Promise<GetOrderAuditReturnType> {
  const response = await client.request({ method: 'getBridgeOrderAudit', params })
  return unwrapEnvelope<BridgeOrderAuditDto>(response)
}
