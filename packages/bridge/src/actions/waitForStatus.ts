import type { BridgeChainClients } from '../connections/resolve.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { WaitForStatusParameters } from '../types/actions.js'
import type { BridgeReceipt, BridgeRegistry } from '../types/protocol.js'
import type { XReserveHttpTransport } from '../types/xreserve.js'
import { getStatus } from './getStatus.js'
import { resolveTransferRoute } from './internal/resolveTransferRoute.js'

/**
 * Follows an in-progress cross-chain transfer until it reaches a selected state.
 *
 * The action repeatedly checks source confirmation, bridge provider processing,
 * and destination delivery until one of the caller's requested states is
 * reached. Progress updates can be saved for display or later recovery.
 *
 * The action does not request a signature, submit a transaction, or move funds.
 *
 * @param registry Supported chains, assets, and bridge provider deployments.
 * @param clients Network access for the chains involved in the transfer.
 * @param client HTTP access for bridge provider status checks.
 * @param params Transfer details, latest receipt, stopping states, polling controls, and optional progress callback.
 * @returns The transfer state that first matches one of the requested stopping states.
 * @throws BridgeError When polling settings are invalid, the wait times out or is cancelled, required network access is unavailable, or a provider returns invalid data.
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
