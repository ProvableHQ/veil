import { BridgeError } from '../errors/bridgeErrors.js'
import type { BridgeCheckpoint, BridgePlan, BridgeReceipt } from '../types/protocol.js'

/**
 * Captures the information an application needs to return to a cross-chain transfer after an interruption.
 *
 * The result includes the route, assets, amount, recipient, and submitted
 * transaction identifiers. It excludes private keys, Aleo record contents, and
 * the secret used for a private xReserve mint.
 *
 * Creating a checkpoint does not contact a network or store data on the
 * caller's behalf. The application decides whether and where to save it.
 *
 * @param plan Transfer details that identify the route, assets, amount, and recipient.
 * @param receipt Latest state returned after a wallet submission.
 * @returns Public recovery information suitable for optional durable storage.
 * @throws BridgeError When the receipt belongs to a different transfer route.
 * @example const checkpoint = createBridgeCheckpoint(plan, execution.receipt)
 */
export function createBridgeCheckpoint(
  plan: BridgePlan,
  receipt: BridgeReceipt,
): BridgeCheckpoint {
  if (receipt.protocol !== plan.protocol || receipt.protocolState.routeId !== plan.route.id) {
    throw new BridgeError('Bridge receipt does not match the prepared route')
  }
  // Checkpoints use an allowlist, not a copy of protocolState. This prevents
  // protocol response bodies and private-mint secrets from leaking into storage.
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
  const preparedTransaction = receipt.protocolState.preparedTransaction
  if (preparedTransaction !== undefined
    && (typeof preparedTransaction !== 'string' || !preparedTransaction)) {
    throw new BridgeError('Bridge receipt contains an invalid prepared transaction')
  }
  const preparedDestinationTransaction = receipt.protocolState.preparedDestinationTransaction
  if (preparedDestinationTransaction !== undefined
    && (typeof preparedDestinationTransaction !== 'string' || !preparedDestinationTransaction)) {
    throw new BridgeError('Bridge receipt contains an invalid prepared destination transaction')
  }
  const blockhash = receipt.protocolState.blockhash
  const lastValidBlockHeight = receipt.protocolState.lastValidBlockHeight
  if ((blockhash !== undefined || lastValidBlockHeight !== undefined)
    && (typeof blockhash !== 'string' || !blockhash
      || typeof lastValidBlockHeight !== 'string' || !/^\d+$/.test(lastValidBlockHeight))) {
    throw new BridgeError('Bridge receipt contains an invalid Solana blockhash lifetime')
  }
  // Source state records either a proved Aleo transaction, submitted approval
  // transactions, or the irreversible source transaction identifier.
  const source = approvals.length > 0 || receipt.sourceTxId || preparedTransaction
    ? {
        ...(approvals.length > 0 ? { approvalTransactionIds: approvals } : {}),
        ...(receipt.sourceTxId ? { transactionId: receipt.sourceTxId } : {}),
        ...(typeof receipt.protocolState.hookData === 'string'
          ? { hookData: receipt.protocolState.hookData }
          : {}),
        ...(typeof blockhash === 'string' && typeof lastValidBlockHeight === 'string'
          ? { blockhash, lastValidBlockHeight }
          : {}),
        ...(typeof preparedTransaction === 'string'
          ? { preparedTransaction: { transactionId: receipt.id, serializedTransaction: preparedTransaction } }
          : {}),
      }
    : undefined
  const balanceBeforeAtomic = receipt.protocolState.destinationBalanceBeforeAtomic
  const expectedIncreaseAtomic = receipt.protocolState.expectedDestinationIncreaseAtomic
  if ((balanceBeforeAtomic !== undefined || expectedIncreaseAtomic !== undefined)
    && (typeof balanceBeforeAtomic !== 'string' || !/^\d+$/.test(balanceBeforeAtomic)
      || typeof expectedIncreaseAtomic !== 'string' || !/^\d+$/.test(expectedIncreaseAtomic))) {
    throw new BridgeError('Bridge receipt contains invalid destination balance verification state')
  }
  // The intent is sufficient to resolve the current route catalog again during
  // recovery; deployed contracts and provider payloads are deliberately omitted.
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
    ...(receipt.destinationTxId || typeof preparedDestinationTransaction === 'string'
      ? {
          destination: {
            ...(receipt.destinationTxId ? { transactionId: receipt.destinationTxId } : {}),
            ...(typeof preparedDestinationTransaction === 'string'
              ? { preparedTransaction: { transactionId: receipt.id, serializedTransaction: preparedDestinationTransaction } }
              : {}),
          },
        }
      : {}),
    ...(typeof balanceBeforeAtomic === 'string' && typeof expectedIncreaseAtomic === 'string'
      ? { deliveryVerification: { balanceBeforeAtomic, expectedIncreaseAtomic } }
      : {}),
  }
}
