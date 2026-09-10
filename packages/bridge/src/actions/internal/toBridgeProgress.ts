import type { BridgePlan, BridgeProgress, BridgeReceipt } from '../../types/protocol.js'

function failureMessage(receipt: BridgeReceipt): string {
  const state = receipt.protocolState
  const message = state.destinationError ?? state.sourceError
  return typeof message === 'string' ? message : `Bridge transfer ended in ${receipt.status}`
}

/** Converts a validated plan and receipt into an explicit caller next step. */
export function toBridgeProgress(plan: BridgePlan, receipt: BridgeReceipt): BridgeProgress {
  if (receipt.status === 'SOURCE_SUBMISSION_PENDING') return { next: 'resume', plan, receipt }
  if (receipt.status === 'DESTINATION_ACTION_REQUIRED') return { next: 'complete', plan, receipt }
  if (receipt.status === 'COMPLETED') return { next: 'done', plan, receipt }
  if (receipt.status === 'FAILED' || receipt.status === 'EXPIRED') {
    return { next: 'failed', plan, receipt, error: failureMessage(receipt) }
  }
  return { next: 'wait', plan, receipt }
}
