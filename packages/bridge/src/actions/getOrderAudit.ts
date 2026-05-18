import type { Client } from '@veil/core'
import { unwrapEnvelope } from '../utils/unwrapEnvelope.js'
import type { BridgeOrderAuditDto } from '../types/bridge.js'

export type GetOrderAuditParameters = { id: string }
export type GetOrderAuditReturnType = BridgeOrderAuditDto

export async function getOrderAudit(
  client: Client,
  params: GetOrderAuditParameters,
): Promise<GetOrderAuditReturnType> {
  const response = await client.request({ method: 'getBridgeOrderAudit', params })
  return unwrapEnvelope<BridgeOrderAuditDto>(
    response as { data: BridgeOrderAuditDto; meta?: Record<string, unknown> },
    { keepMeta: false },
  )
}
