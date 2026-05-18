import type { Client } from '@veil/core'
import { unwrapEnvelope } from '../utils/unwrapEnvelope.js'
import type { BridgeOrderStatusDto } from '../types/bridge.js'

export type GetOrderParameters = { id: string }
export type GetOrderReturnType = BridgeOrderStatusDto

export async function getOrder(
  client: Client,
  params: GetOrderParameters,
): Promise<GetOrderReturnType> {
  const response = await client.request({ method: 'getBridgeOrder', params })
  return unwrapEnvelope<BridgeOrderStatusDto>(
    response as { data: BridgeOrderStatusDto; meta?: Record<string, unknown> },
    { keepMeta: false },
  )
}
