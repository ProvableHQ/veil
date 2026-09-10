import { BridgeError } from '../errors/bridgeErrors.js'
import type { BridgeCheckpoint, BridgePlan, BridgeReceipt } from '../types/protocol.js'

/**
 * Reduces one execution receipt to a versioned recovery checkpoint.
 *
 * Pure and local: retains submitted transaction identifiers while excluding
 * the plan and protocol-native response data.
 *
 * @param plan Prepared transfer whose route binds the checkpoint.
 * @param receipt Latest receipt emitted after a wallet submission.
 * @returns Compact checkpoint suitable for optional durable storage.
 * @throws BridgeError When the receipt does not belong to the prepared route.
 * @example const checkpoint = createBridgeCheckpoint(plan, execution.receipt)
 */
export function createBridgeCheckpoint(
  plan: BridgePlan,
  receipt: BridgeReceipt,
): BridgeCheckpoint {
  if (receipt.protocol !== plan.protocol || receipt.protocolState.routeId !== plan.route.id) {
    throw new BridgeError('Bridge receipt does not match the prepared route')
  }
  const rawApprovals = receipt.protocolState.approvalTxIds
  if (rawApprovals !== undefined
    && (!Array.isArray(rawApprovals) || rawApprovals.some((value) => typeof value !== 'string'))) {
    throw new BridgeError('Bridge receipt contains invalid approval transaction identifiers')
  }
  const approvals = (rawApprovals ?? []) as string[]
  const source = approvals.length > 0 || receipt.sourceTxId
    ? {
        ...(approvals.length > 0 ? { approvalTransactionIds: approvals } : {}),
        ...(receipt.sourceTxId ? { transactionId: receipt.sourceTxId } : {}),
      }
    : undefined
  return {
    version: 1,
    routeId: plan.route.id,
    protocol: plan.protocol,
    ...(source ? { source } : {}),
    ...(receipt.destinationTxId ? { destination: { transactionId: receipt.destinationTxId } } : {}),
  }
}
