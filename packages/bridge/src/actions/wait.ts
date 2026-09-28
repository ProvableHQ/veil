import type { BridgeChainClients } from '../connections/resolve.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import type { WaitParameters } from '../types/actions.js'
import type { BridgeProgress, BridgeRegistry, BridgeStatus } from '../types/protocol.js'
import type { XReserveHttpTransport } from '../types/xreserve.js'
import { resolveTransferRoute } from './internal/resolveTransferRoute.js'
import { toBridgeProgress } from './internal/toBridgeProgress.js'
import { getStatus } from './getStatus.js'

const CALLER_BOUNDARIES: readonly BridgeStatus[] = [
  'SOURCE_SUBMISSION_PENDING',
  'DESTINATION_ACTION_REQUIRED',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
]

/**
 * Follows a cross-chain transfer until it finishes or requires another wallet authorization.
 *
 * The action monitors source confirmation, provider processing, and destination
 * delivery where those stages can be verified. The result states whether the
 * funds arrived, the transfer failed, or another source- or destination-chain
 * transaction is required.
 *
 * Monitoring does not request a signature, submit a transaction, or move funds.
 *
 * @param registry Supported chains, assets, and bridge provider deployments.
 * @param clients Network access for the chains involved in the transfer.
 * @param client HTTP access for bridge provider status checks.
 * @param params Current transfer state, optional stopping statuses, polling controls, and optional progress callback.
 * @returns The completed or failed transfer, or the next transaction the caller must authorize.
 * @throws BridgeError When the saved state does not belong to the transfer, the wait times out or is cancelled, or a network or provider check fails.
 * @example const next = await wait(registry, clients, fetch, { progress })
 */
export async function wait(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  client: XReserveHttpTransport,
  params: WaitParameters,
): Promise<BridgeProgress> {
  const { plan, receipt } = params.progress
  if (params.until?.length === 0) throw new BridgeError('wait requires at least one target status when until is provided')
  resolveTransferRoute(registry, plan)
  if (receipt.protocol !== plan.protocol || receipt.protocolState.routeId !== plan.route.id) {
    throw new BridgeError('Bridge progress does not match its reconstructed plan')
  }
  const current = toBridgeProgress(plan, receipt)
  const until = [...new Set([...CALLER_BOUNDARIES, ...(params.until ?? [])])]
  if (current.next !== 'wait' || until.includes(receipt.status)) return current
  const requestedInterval = params.pollingIntervalMs ?? 15_000
  const timeoutMs = params.timeoutMs ?? 20 * 60_000
  if (!Number.isFinite(requestedInterval) || requestedInterval < 0 || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new BridgeError('Status polling controls must be non-negative finite numbers')
  }
  const interval = requestedInterval === 0 ? 0 : Math.max(100, requestedInterval)
  const deadline = Date.now() + timeoutMs
  let updated = receipt

  // Poll one canonical status transition at a time so every observed change can
  // be persisted before another provider or chain read begins.
  while (true) {
    if (params.signal?.aborted) throw new BridgeError('Bridge status polling was cancelled')
    const next = await getStatus(registry, clients, client, { plan, receipt: updated, signal: params.signal })
    if (next !== updated) await params.onUpdate?.(toBridgeProgress(plan, next))
    updated = next
    if (until.includes(updated.status)) return toBridgeProgress(plan, updated)
    if (Date.now() >= deadline) throw new BridgeError(`Bridge status polling timed out in state ${updated.status}`)
    await new Promise<void>((resolve) => setTimeout(resolve, interval))
  }
}
