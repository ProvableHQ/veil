import type { Client } from '@veil/core'
import { getOrder } from './getOrder.js'
import { BridgeOrderFailedError, BridgeTimeoutError } from '../errors/bridgeErrors.js'
import {
  isTerminalStage,
  type BridgeOrderStage,
  type BridgeOrderStatusDto,
} from '../types/bridge.js'

export type WaitForOrderParameters = {
  id: string
  /** Target stage to wait for; defaults to 'COMPLETED'. Compared to BridgeOrderStatusDto.status. */
  until?: BridgeOrderStage | undefined
  pollIntervalMs?: number | undefined
  timeoutMs?: number | undefined
  onStage?: ((status: BridgeOrderStatusDto) => void) | undefined
}

export type WaitForOrderReturnType = BridgeOrderStatusDto

const FAILURE_STAGES: ReadonlyArray<string> = ['EXPIRED', 'FAILED', 'REFUNDED', 'DELETED']

export async function waitForOrder(
  client: Client,
  params: WaitForOrderParameters,
): Promise<WaitForOrderReturnType> {
  const until: string = params.until ?? 'COMPLETED'
  const initialInterval = params.pollIntervalMs ?? 3000
  const timeoutMs = params.timeoutMs ?? 30 * 60_000
  const deadline = Date.now() + timeoutMs

  let interval = initialInterval

  while (true) {
    const status = await getOrder(client, { id: params.id })
    params.onStage?.(status)

    if (status.status === until) return status

    if (FAILURE_STAGES.includes(status.status)) {
      throw new BridgeOrderFailedError(
        status.status,
        status.orderId,
        status.finalStatus?.reason?.message,
      )
    }

    if (isTerminalStage(status.status)) {
      return status
    }

    if (Date.now() >= deadline) {
      throw new BridgeTimeoutError(params.id, timeoutMs)
    }

    await new Promise((resolve) => setTimeout(resolve, interval))
    interval = Math.min(interval * 1.5, 30_000)
  }
}
