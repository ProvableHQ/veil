import type { BridgePlan, BridgeProgress, BridgeReceipt } from '../../types/protocol.js'

/** Selects the provider or chain failure recorded in a terminal receipt for display to an operator. */
function failureMessage(receipt: BridgeReceipt): string {
  const state = receipt.protocolState
  const message = state.destinationError ?? state.sourceError
  return typeof message === 'string' ? message : `Bridge transfer ended in ${receipt.status}`
}

/**
 * Translates protocol status into the one operation an application can perform next.
 *
 * The result separates observation (`wait`) from wallet authorization
 * (`resume` or `complete`) and terminal outcomes (`done` or `failed`). It does
 * not read a network, request a signature, submit a transaction, or store state.
 */
export function toBridgeProgress(plan: BridgePlan, receipt: BridgeReceipt): BridgeProgress {
  // Source submission pending means approvals or pre-broadcast proving finished,
  // but the fund-moving source transaction still needs explicit authorization.
  if (receipt.status === 'SOURCE_SUBMISSION_PENDING') return { next: 'resume', plan, receipt }
  // Destination action required is currently xReserve private mint: Circle has
  // attested the deposit, but the Aleo recipient still must authorize delivery.
  if (receipt.status === 'DESTINATION_ACTION_REQUIRED') return { next: 'complete', plan, receipt }
  if (receipt.status === 'COMPLETED') return { next: 'done', plan, receipt }
  if (receipt.status === 'FAILED' || receipt.status === 'EXPIRED') {
    return { next: 'failed', plan, receipt, error: failureMessage(receipt) }
  }
  return { next: 'wait', plan, receipt }
}
