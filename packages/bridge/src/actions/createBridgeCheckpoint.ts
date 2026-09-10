import { BridgeError } from '../errors/bridgeErrors.js'
import type { BridgeCheckpoint, BridgePlan, BridgeReceipt } from '../types/protocol.js'

/**
 * Reduces one execution receipt to a versioned recovery checkpoint.
 *
 * Pure and local: retains public transfer intent and submitted transaction
 * identifiers while excluding secrets and protocol-native response data.
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
  const approvals = [...(rawApprovals ?? [])] as string[]
  const sourceSender = receipt.protocolState.sourceSender
  if (sourceSender !== undefined && typeof sourceSender !== 'string') {
    throw new BridgeError('Bridge receipt contains an invalid source sender')
  }
  const sender = plan.sender ?? sourceSender
  const source = approvals.length > 0 || receipt.sourceTxId
    ? {
        ...(approvals.length > 0 ? { approvalTransactionIds: approvals } : {}),
        ...(receipt.sourceTxId ? { transactionId: receipt.sourceTxId } : {}),
        ...(typeof receipt.protocolState.hookData === 'string'
          ? { hookData: receipt.protocolState.hookData }
          : {}),
      }
    : undefined
  return {
    version: 1,
    intent: {
      source: { chain: plan.sourceAsset.chainId, asset: plan.sourceAsset.key },
      destination: { chain: plan.destinationAsset.chainId, asset: plan.destinationAsset.key },
      bridgeProtocol: plan.protocol,
      amount: plan.amountIn,
      recipient: plan.recipient,
      ...(sender ? { sender } : {}),
      ...(plan.destinationAsset.locator?.kind === 'aleo-program' ? { mintMode: plan.mintMode } : {}),
    },
    route: { id: plan.route.id, registryVersion: plan.registryVersion },
    ...(source ? { source } : {}),
    ...(receipt.destinationTxId ? { destination: { transactionId: receipt.destinationTxId } } : {}),
  }
}
