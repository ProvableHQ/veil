import type { BridgeChainClients } from '../connections/resolve.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { WaitParameters } from '../types/actions.js'
import type { BridgeProgress, BridgeRegistry, BridgeStatus } from '../types/protocol.js'
import type { XReserveHttpTransport } from '../types/xreserve.js'
import { resolveTransferRoute } from './internal/resolveTransferRoute.js'
import { toBridgeProgress } from './internal/toBridgeProgress.js'
import { waitForStatus } from './waitForStatus.js'

const CALLER_BOUNDARIES: readonly BridgeStatus[] = [
  'SOURCE_SUBMISSION_PENDING',
  'DESTINATION_ACTION_REQUIRED',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
]

/**
 * Waits until recovered progress reaches a caller-action or terminal boundary.
 *
 * Performs reads only. It returns immediately when progress already identifies
 * a source resumption, destination completion, or terminal result. Delivery
 * pending is not a stopping boundary because it requires no caller
 * authorization; polling continues until delivery completes or fails.
 *
 * @param registry Reviewed deployment snapshot.
 * @param clients Materialized chain clients used only for status reads.
 * @param client Fetch-compatible protocol transport used for attestation reads.
 * @param params Reconstructed progress and optional polling controls.
 * @returns Updated progress with an explicit next operation.
 * @throws BridgeError When progress is mismatched or polling fails.
 * @example const next = await wait(registry, clients, fetch, { progress })
 */
export async function wait(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  client: XReserveHttpTransport,
  params: WaitParameters,
): Promise<BridgeProgress> {
  const { plan, receipt } = params.progress
  resolveTransferRoute(registry, plan)
  if (receipt.protocol !== plan.protocol || receipt.protocolState.routeId !== plan.route.id) {
    throw new BridgeError('Bridge progress does not match its reconstructed plan')
  }
  const current = toBridgeProgress(plan, receipt)
  if (current.next !== 'wait' || CALLER_BOUNDARIES.includes(receipt.status)) return current

  const updated = await waitForStatus(registry, clients, client, {
    plan,
    receipt,
    until: CALLER_BOUNDARIES,
    pollingIntervalMs: params.pollingIntervalMs,
    timeoutMs: params.timeoutMs,
    signal: params.signal,
    onUpdate: params.onUpdate
      ? async (value) => params.onUpdate?.(toBridgeProgress(plan, value))
      : undefined,
  })
  return toBridgeProgress(plan, updated)
}
