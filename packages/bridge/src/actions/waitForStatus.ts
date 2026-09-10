import type { BridgeChainClients } from '../connections/resolve.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { WaitForStatusParameters } from '../types/actions.js'
import type { BridgeReceipt, BridgeRegistry } from '../types/protocol.js'
import type { XReserveHttpTransport } from '../types/xreserve.js'
import { getStatus } from './getStatus.js'
import { resolveTransferRoute } from './internal/resolveTransferRoute.js'

/**
 * Polls bridge status using read-only protocol and chain operations.
 *
 * Never signs or submits a transaction. Returns only after a requested state
 * is reached; timeout and cancellation errors leave the caller's last
 * `onUpdate` checkpoint resumable.
 *
 * @param registry Reviewed deployment snapshot.
 * @param clients Materialized chain clients keyed by registry chain id.
 * @param client Fetch-compatible protocol transport.
 * @param params Receipt, stopping states, polling controls, and checkpoint callback.
 * @returns The first refreshed receipt whose status matches `until`.
 * @throws BridgeError When polling controls are invalid, time expires, cancellation is requested, or a status read fails.
 * @example const ready = await waitForStatus(registry, clients, fetch, { plan, receipt, until: ['DESTINATION_ACTION_REQUIRED'] })
 */
export async function waitForStatus(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  client: XReserveHttpTransport,
  params: WaitForStatusParameters,
): Promise<BridgeReceipt> {
  resolveTransferRoute(registry, params.plan)
  if (params.receipt.protocol !== params.plan.protocol
    || params.receipt.protocolState.routeId !== params.plan.route.id) {
    throw new BridgeError('Bridge receipt does not match the prepared route')
  }
  if (params.until.length === 0) throw new BridgeError('waitForStatus requires at least one target status')
  const requestedInterval = params.pollingIntervalMs ?? 15_000
  const timeoutMs = params.timeoutMs ?? 20 * 60_000
  if (!Number.isFinite(requestedInterval) || requestedInterval < 0 || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new BridgeError('Status polling controls must be non-negative finite numbers')
  }
  const interval = requestedInterval === 0 ? 0 : Math.max(100, requestedInterval)
  const deadline = Date.now() + timeoutMs
  let receipt = params.receipt

  while (true) {
    if (params.signal?.aborted) throw new BridgeError('Bridge status polling was cancelled')
    if (params.until.includes(receipt.status)) return receipt
    const next = await getStatus(registry, clients, client, { plan: params.plan, receipt, signal: params.signal })
    if (next !== receipt) await params.onUpdate?.(next)
    receipt = next
    if (params.until.includes(receipt.status)) return receipt
    if (Date.now() >= deadline) throw new BridgeError(`Bridge status polling timed out in state ${receipt.status}`)
    await new Promise<void>((resolve) => setTimeout(resolve, interval))
  }
}
