import { requireEvmClientWithWallet, type BridgeChainClients } from '../connections/resolve.js'
import { BridgeError } from '../errors/bridgeErrors.js'
import * as evmHyperlane from '../protocols/hyperlane/evm.js'
import * as evmToAleoXReserve from '../protocols/xreserve/evmToAleo.js'
import type { ResumeParameters, BridgeExecution } from '../types/actions.js'
import type { BridgeRegistry, BridgeReceipt } from '../types/protocol.js'
import { aleoAddressToBytes32 } from '../utils/xreserve.js'
import { createBridgeCheckpoint } from './createBridgeCheckpoint.js'
import { resolveTransferRoute } from './internal/resolveTransferRoute.js'

/**
 * Continues the remaining source submission from recovered progress.
 *
 * Calls a wallet only when recovery identified a confirmed approval with no
 * irreversible source transfer. It never repeats a checkpointed transaction.
 *
 * @param registry Reviewed deployment snapshot.
 * @param clients Materialized chain clients used for the remaining submission.
 * @param params Recovered resumable progress and optional confirmation controls.
 * @returns Protocol-discriminated execution state after source continuation.
 * @throws BridgeError When progress is not resumable or the route lacks source resumption.
 * @example const execution = await resume(registry, clients, { progress })
 */
export async function resume(
  registry: BridgeRegistry,
  clients: BridgeChainClients,
  params: ResumeParameters,
): Promise<BridgeExecution> {
  const { plan, receipt } = params.progress
  if (params.progress.next !== 'resume' || receipt.status !== 'SOURCE_SUBMISSION_PENDING') {
    throw new BridgeError('Bridge progress has no source submission to resume')
  }
  const route = resolveTransferRoute(registry, plan)
  const onSubmitted = params.onCheckpoint
    ? async (value: BridgeReceipt) => params.onCheckpoint?.(createBridgeCheckpoint(plan, value))
    : undefined

  if (route.route.protocol === 'xreserve' && route.sourceChain.family === 'evm') {
    const execution = await evmToAleoXReserve.execute(
      registry,
      requireEvmClientWithWallet(registry, clients, route.sourceChain.id, 'resume xReserve transfer'),
      {
        plan,
        resume: receipt,
        pollingIntervalMs: params.pollingIntervalMs,
        confirmationTimeoutMs: params.confirmationTimeoutMs,
        onSubmitted,
        privateMintSecretNonce: params.privateMintSecretNonce,
      },
    )
    return { kind: 'evm-xreserve', ...execution }
  }
  if (route.route.protocol === 'hyperlane' && route.sourceChain.family === 'evm') {
    const execution = await evmHyperlane.execute(
      registry,
      requireEvmClientWithWallet(registry, clients, route.sourceChain.id, 'resume Hyperlane transfer'),
      {
        plan,
        recipientBytes32: aleoAddressToBytes32(plan.recipient),
        resume: receipt,
        pollingIntervalMs: params.pollingIntervalMs,
        confirmationTimeoutMs: params.confirmationTimeoutMs,
        onSubmitted,
      },
    )
    return { kind: 'evm-hyperlane', ...execution }
  }
  throw new BridgeError('Source resumption is not implemented for this bridge route')
}
