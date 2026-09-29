import { createBridgeCheckpoint, type BridgeCheckpoint, type BridgeClient, type BridgePlan, type BridgeProgress } from '@provablehq/aleo-bridge-sdk'

/**
 * Follows one public-balance roundtrip leg without repeating a saved submission.
 * @param bridge SDK client with the selected source signer when execution is authorized.
 * @param options Saved checkpoint or fresh quoted plan, plus a durable checkpoint writer.
 * @returns Verified CCTP completion or the xReserve provider handoff; handoff is not destination delivery.
 * @throws When submission, recovery, polling, or the transfer fails or requires unexpected private/manual completion.
 * @example const progress = await followRoundtripLeg(bridge, { checkpoint, persist: save })
 */
export async function followRoundtripLeg(bridge: BridgeClient, options: {
  checkpoint?: BridgeCheckpoint
  plan?: BridgePlan
  persist: (checkpoint: BridgeCheckpoint) => void
}): Promise<BridgeProgress> {
  let progress: BridgeProgress
  if (options.checkpoint) {
    progress = await bridge.recover({ checkpoint: options.checkpoint })
  } else {
    if (!options.plan) throw new Error('A fresh leg requires a quoted plan')
    const result = await bridge.execute({ plan: options.plan, mode: 'public-as-signer', onCheckpoint: options.persist })
    progress = { next: 'wait', plan: options.plan, receipt: result.receipt }
  }
  for (;;) {
    if (progress.next === 'failed') throw new Error(progress.error)
    if (progress.next === 'done') return progress
    // Public xReserve settlement belongs to the provider. The caller must
    // observe destination delivery separately before advancing to another leg.
    if (progress.plan.protocol === 'xreserve' && progress.receipt.status === 'DELIVERY_PENDING') return progress
    if (progress.next === 'complete') throw new Error('Unexpected destination authorization; retain the checkpoint for manual recovery')
    if (progress.next === 'resume') {
      const result = await bridge.resume({ progress, onCheckpoint: options.persist })
      progress = { next: 'wait', plan: progress.plan, receipt: result.receipt }
    }
    progress = await bridge.wait({
      progress, until: progress.plan.protocol === 'xreserve' ? ['DELIVERY_PENDING'] : undefined,
      timeoutMs: 20 * 60_000, pollingIntervalMs: 5_000,
      onUpdate(update) { options.persist(createBridgeCheckpoint(update.plan, update.receipt)) },
    })
  }
}
