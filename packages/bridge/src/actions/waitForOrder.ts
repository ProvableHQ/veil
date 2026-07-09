import type { Client } from '@provablehq/veil-core'
import { getOrder } from './getOrder.js'
import { BridgeOrderFailedError, BridgeTimeoutError } from '../errors/bridgeErrors.js'
import {
  isTerminalStage,
  TERMINAL_STAGES,
  type BridgeOrderStage,
  type BridgeOrderStatusDto,
} from '../types/bridge.js'

/**
 * Parameters for `waitForOrder`.
 *
 * @property id Bridge order id, from `createOrder`.
 * @property until Target stage to wait for, compared to
 *   `BridgeOrderStatusDto.status`. Defaults to `'COMPLETED'`.
 * @property pollIntervalMs Initial delay between polls; backs off 1.5× per
 *   round up to 30s. Defaults to 3000.
 * @property timeoutMs Overall deadline. Defaults to 30 minutes.
 * @property onStage Called with every status observed, including the last.
 */
export type WaitForOrderParameters = {
  id: string
  until?: BridgeOrderStage | undefined
  pollIntervalMs?: number | undefined
  timeoutMs?: number | undefined
  onStage?: ((status: BridgeOrderStatusDto) => void) | undefined
}

export type WaitForOrderReturnType = BridgeOrderStatusDto

// Terminal stages that are not the happy ending — derived so the two lists
// cannot drift apart.
const FAILURE_STAGES: ReadonlyArray<string> = TERMINAL_STAGES.filter((s) => s !== 'COMPLETED')

/**
 * Polls a bridge order until it reaches the target stage or ends terminally.
 *
 * Hits the network repeatedly (one `getOrder` per poll, with exponential
 * backoff). Resolves with the status that satisfied the wait; an unexpected
 * terminal `COMPLETED` also resolves, while failure stages throw.
 *
 * @param client A client whose transport is `httpBridge`.
 * @param params Order id, target stage, and polling knobs.
 * @returns The order status that ended the wait.
 * @throws BridgeOrderFailedError When the order ends in a failure stage
 *   (`FAILED`, `EXPIRED`, `REFUNDED`, `DELETED`) — carries the stage and reason.
 * @throws BridgeTimeoutError When the deadline passes first.
 *
 * @example
 * const done = await waitForOrder(client, { id: order.orderId })
 */
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

    // Clamp the sleep to the remaining deadline so the poller cannot sleep
    // (and then fetch once more) past timeoutMs.
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new BridgeTimeoutError(params.id, timeoutMs)
    await new Promise((resolve) => setTimeout(resolve, Math.min(interval, remaining)))
    interval = Math.min(interval * 1.5, 30_000)
  }
}
