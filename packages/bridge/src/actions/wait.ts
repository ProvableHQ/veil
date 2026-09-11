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
 * @param params Current transfer state, polling controls, and optional progress callback.
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
